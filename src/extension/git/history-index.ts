import { readStashes } from './stashes';
import type { Author, Commit, HistoryFilters } from '../../shared/model';
import { git } from './client';
import { resolveUsers } from '../../shared/filters';
import { createMessageIndex, type MessageIndexState } from './message-index';
import { setImmediate as yieldToHost } from 'node:timers/promises';

export const maxIndexCommits = 100_000;
export const historyIndexFormat =
  '--format=%H%x00%P%x00%an%x00%ae%x00%cI%x00%s%x00%D%x00%aI%x00%B%x00';
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());
const hasUnicodeCase = (text: string) => {
  for (const c of text)
    if (c.charCodeAt(0) > 127 && c.toLowerCase() !== c.toUpperCase()) return true;
  return false;
};

// A bounded full-message and author index. The normal Git reader remains the
// authority for regex, revision/path/date filters, signatures and large repos.
export async function readHistoryIndexRaw(root: string) {
  const stashes = await readStashes(root);
  return git(
    root,
    [
      'log',
      '--date-order',
      '--all',
      ...stashes.revisions,
      `--max-count=${maxIndexCommits + 1}`,
      historyIndexFormat,
      '--',
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
}

export async function readHistoryIndex(root: string) {
  return buildHistoryIndex(root, await readHistoryIndexRaw(root));
}

export interface HistoryIndexSeed {
  hashes: string[];
  text: MessageIndexState;
}

export async function buildHistoryIndex(root: string, raw: string, previous?: HistoryIndexSeed) {
  const stashes = await readStashes(root);
  const rows = raw.split('\0\n').filter(Boolean);
  if (rows.length > maxIndexCommits) return undefined; // Never search a partial index.
  const entries: { commit: Commit; message: string; folded: string; unicodeCase: boolean }[] = [];
  for (const [i, row] of rows.entries()) {
    if (i % 512 === 0) await yieldToHost();
    const [hash, parents, author, email, date, subject, decorations, authorDate, message] = row
      .replace(/^\n/, '')
      .split('\0');
    if (stashes.internal.has(hash)) continue;
    const unicodeCase = hasUnicodeCase(message);
    const commit: Commit = {
      hash,
      parents: parents.split(' ').filter(Boolean),
      author,
      email,
      date,
      subject,
      decorations,
      authorDate,
      signature: undefined,
    };
    entries.push({
      commit: stashes.visible([commit])[0],
      message,
      folded: asciiLower(message),
      unicodeCase,
    });
  }
  let hashes = [...(previous?.hashes || [])];
  let ids = new Map(hashes.map((hash, i) => [hash, i]));
  if (
    hashes.length + entries.filter(({ commit }) => !ids.has(commit.hash)).length >
    maxIndexCommits
  ) {
    previous = undefined;
    hashes = [];
    ids = new Map();
  }
  const addedMessages: string[] = [];
  const currentRows = new Map<number, number>();
  for (const [row, entry] of entries.entries()) {
    if (!ids.has(entry.commit.hash)) {
      ids.set(entry.commit.hash, hashes.length);
      hashes.push(entry.commit.hash);
      addedMessages.push(entry.folded);
    }
    currentRows.set(ids.get(entry.commit.hash)!, row);
  }
  const textIndex = await createMessageIndex(addedMessages, undefined, previous?.text);
  const authorRows = new Map<string, number[]>();
  const authors: Author[] = [];
  const uncertainRows: number[] = [];
  let unicodeAuthors = false;
  for (const [row, { commit, unicodeCase }] of entries.entries()) {
    const key = commit.author + '\0' + commit.email;
    let list = authorRows.get(key);
    if (!list) {
      authorRows.set(key, (list = []));
      authors.push({ name: commit.author ?? '', email: commit.email ?? '' });
      unicodeAuthors ||= hasUnicodeCase(key);
    }
    list.push(row);
    if (unicodeCase) uncertainRows.push(row);
  }
  return {
    seed: { hashes, text: textIndex.state },
    authors,
    count: entries.length,
    textKeys: textIndex.keys,
    postingBytes: textIndex.bytes,
    async search(
      ref: string | string[],
      limit: number,
      filters: HistoryFilters,
      current: Author = { name: '', email: '' },
    ): Promise<Commit[] | undefined> {
      if (
        (Array.isArray(ref) ? ref.length : ref) ||
        Object.entries(filters).some(
          ([key, value]) =>
            ![
              'text',
              'matchCase',
              'sort',
              'hideMerges',
              'highlightNotPicked',
              'authorQueries',
            ].includes(key) && (Array.isArray(value) ? value.length : value),
        )
      )
        return undefined;
      if (filters.authorQueries?.length && unicodeAuthors && !filters.matchCase) return undefined;
      const query = String(filters.text || '').trim();
      if (filters.sort === 'topological' || /^[a-f0-9]{4,64}$/i.test(query) || /[\r\n]/.test(query))
        return undefined;
      // Git's Unicode/locale regex folding is not JavaScript's. Use the index
      // only where literal comparison is equivalent; otherwise let Git decide.
      if (
        query &&
        !filters.matchCase &&
        (hasUnicodeCase(query) ||
          /^(tr|az)/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || ''))
      )
        return undefined;
      // A handful of messages can contain non-ASCII case mappings. Ask Git to
      // match just those commits, instead of giving up the index for the entire repo.
      const uncertain = query && !filters.matchCase ? uncertainRows.map((row) => entries[row]) : [];
      if (uncertain.length > 1000) return undefined;
      const exactMatches = uncertain.length
        ? new Set(
            (
              await git(
                root,
                [
                  'log',
                  '--no-walk=unsorted',
                  '--format=%H',
                  '--extended-regexp',
                  '--regexp-ignore-case',
                  `--grep=${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
                  '--stdin',
                  '--',
                ],
                { input: uncertain.map((entry) => entry.commit.hash).join('\n') + '\n' },
              )
            )
              .trim()
              .split('\n'),
          )
        : undefined;
      const needle = filters.matchCase ? query : asciiLower(query);
      let candidates = textIndex
        .candidates(asciiLower(query))
        ?.map((id) => currentRows.get(id))
        .filter((row) => row !== undefined)
        .sort((a, b) => a - b);
      if (candidates && query && !filters.matchCase)
        candidates = [...new Set([...candidates, ...uncertainRows])].sort((a, b) => a - b);
      if (filters.authorQueries?.length) {
        const matched = resolveUsers(filters.authorQueries, authors, current);
        const selected = new Set(
          matched.flatMap((author) => authorRows.get(author.name + '\0' + author.email) || []),
        );
        candidates = candidates
          ? candidates.filter((row) => selected.has(row))
          : [...selected].sort((a, b) => a - b);
      }
      const result: Commit[] = [];
      for (const row of candidates ?? entries.keys()) {
        const entry = entries[row];
        if (filters.hideMerges && entry.commit.parents.length > 1) continue;
        if (query) {
          const matches =
            !filters.matchCase && entry.unicodeCase
              ? exactMatches?.has(entry.commit.hash)
              : (filters.matchCase ? entry.message : entry.folded).includes(needle);
          if (!matches) continue;
        }
        result.push(entry.commit);
        if (limit > 0 && result.length >= limit) break;
      }
      return result;
    },
  };
}
