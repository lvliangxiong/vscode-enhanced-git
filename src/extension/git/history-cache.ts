import { readStashes } from './stashes';
import { randomUUID } from 'node:crypto';
import type { loadHistoryPage } from './history-page';
import { git } from './client';
import { historyIdentity } from './history-identity';
import { refs, readAuthors } from './refs';
import type { HistoryContext } from './history';
import { readHistoryIndex } from './history-index';
import type { createPathIndexStore } from './path-index-store';

type HistoryPage = Awaited<ReturnType<typeof loadHistoryPage>>;

// Kept per Log view, not globally: closing a tab releases its search results.
// Results retain full Git semantics; this is not a search of the loaded page.
export class HistorySnapshot {
  readonly key = randomUUID();
  private metadata = new Map<string, Promise<unknown>>();
  private results = new Map<string, { value: Promise<HistoryPage>; rows: number }>();
  private rows = 0;
  private index: Awaited<ReturnType<typeof readHistoryIndex>>;
  private indexing: Promise<void>;

  prepareIndex(): Promise<void> {
    // Optional acceleration: failures/oversized repositories use the Git path.
    return (this.indexing ??= Promise.all([
      this.readIndex().then(
        (index) => {
          this.index = index;
        },
        () => {},
      ),
      this.paths?.prepare().catch(() => {}),
    ]).then(() => {}));
  }

  constructor(
    readonly root: string,
    private maxResults = 12,
    private maxRows = 20_000,
    private readIndex = () => readHistoryIndex(root),
    private paths?: { prepare: () => Promise<void>; read: (args: string[]) => Promise<string> },
  ) {}

  private memo<T>(key: string, read: () => Promise<T>): Promise<T> {
    const cached = this.metadata.get(key);
    if (cached) return cached as Promise<T>;
    const value = read();
    this.metadata.set(key, value);
    void value.catch(() => {
      if (this.metadata.get(key) === value) this.metadata.delete(key);
    });
    return value;
  }

  branches = () => this.memo('branches', () => refs(this.root));
  stashes = () => this.memo('stashes', async () => (await readStashes(this.root)).list);
  authors = () =>
    this.index
      ? Promise.resolve(this.index.authors)
      : this.memo('authors', () => readAuthors(this.root));
  user = () =>
    this.memo('user', () =>
      Promise.all([
        git(this.root, ['config', '--get', 'user.email']).catch(() => ''),
        git(this.root, ['config', '--get', 'user.name']).catch(() => ''),
      ]),
    );
  head = () => this.memo('head', () => git(this.root, ['rev-list', 'HEAD']).catch(() => ''));
  remotes = () => this.memo('remotes', () => git(this.root, ['remote']));
  context: HistoryContext = {
    branches: this.branches,
    readPaths: (args) =>
      this.paths ? this.paths.read(args) : git(this.root, args, { maxBuffer: Infinity }),
    indexed: (ref, limit, filters) => {
      if (!this.index) return undefined;
      if (!filters.authorQueries?.length) return this.index.search(ref, limit, filters);
      return this.user().then(([email, name]) =>
        this.index.search(ref, limit, filters, { email: email.trim(), name: name.trim() }),
      );
    },
    users: async () => {
      const [authors, [email, name]] = await Promise.all([this.authors(), this.user()]);
      return [authors, email, name];
    },
  };

  history(key: string, read: () => Promise<HistoryPage>): Promise<HistoryPage> {
    const cached = this.results.get(key);
    if (cached) {
      this.results.delete(key);
      this.results.set(key, cached);
      return cached.value;
    }
    const entry = { value: read(), rows: 0 };
    this.results.set(key, entry);
    const remove = (key: string) => {
      this.rows -= this.results.get(key)?.rows || 0;
      this.results.delete(key);
    };
    const trim = () => {
      while (this.results.size > this.maxResults || this.rows > this.maxRows)
        remove(this.results.keys().next().value);
    };
    trim();
    void entry.value.then(
      ({ history }) => {
        if (this.results.get(key) !== entry) return;
        // Loading all commits is supported, but never retain an unbounded history per query.
        if (history.length > this.maxRows) return remove(key);
        entry.rows = history.length;
        this.rows += entry.rows;
        trim();
      },
      () => {
        if (this.results.get(key) === entry) remove(key);
      },
    );
    return entry.value;
  }
}

export function createHistoryCache(
  readIndex?: (
    root: string,
    identity: string,
    force: boolean,
  ) => ReturnType<typeof readHistoryIndex>,
  paths?: ReturnType<typeof createPathIndexStore>,
) {
  let current: { root: string; identity: string; version: number; snapshot: HistorySnapshot };
  let request = 0;
  return {
    clear() {
      request++;
      current = undefined;
    },
    async snapshot(root: string, version = 0, force = false) {
      const id = ++request;
      // Ref checks also cover external operations before VS Code's change event arrives.
      // Config covers upstream selection and the identity used by the `me` filter.
      const identity = await historyIdentity(root);
      if (
        !force &&
        current?.root === root &&
        current.identity === identity &&
        current.version === version
      )
        return current.snapshot;
      // Manual refresh replaces query/metadata caches, not immutable indexes.
      const snapshot = new HistorySnapshot(
        root,
        12,
        20_000,
        readIndex && (() => readIndex(root, identity, false)),
        paths && {
          prepare: () => paths.prepare(root, identity),
          read: (args) => paths.read(root, args),
        },
      );
      if (id === request) current = { root, identity, version, snapshot };
      return snapshot;
    },
  };
}
