const path = require('node:path');
const fs = require('node:fs');
function repositoryKey(root) {
  try {
    return fs.realpathSync.native(root);
  } catch {
    return path.resolve(root);
  }
}

// The public vscode.git API deliberately does not expose operation/silent events.
// Track repository identity instead, so status updates from editing files are cheap.
function historyIdentity(state) {
  const head = state.HEAD;
  return JSON.stringify([
    head && [
      head.type,
      head.name,
      head.commit,
      head.upstream?.remote,
      head.upstream?.name,
      head.upstream?.commit,
      head.ahead,
      head.behind,
    ],
    (state.refs || [])
      .map((ref) => [ref.type, ref.name, ref.commit, ref.remote])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
}
function createRepositoryEvents(vscode, report: (message: string) => void = () => {}, delay = 250) {
  const records = new Map(),
    versions = new Map(),
    listeners = new Set<(event: { root: string; version: number }) => void>(),
    subscriptions: { dispose(): void }[] = [];
  let disposed = false,
    apiSubscriptions: { dispose(): void }[] = [];
  const rootListeners = new Set<() => void>();
  const rootsChanged = () => rootListeners.forEach((listener) => listener());
  const key = repositoryKey;
  const version = (root) => (root ? versions.get(key(root)) || 0 : 0);
  // Our Git CLI operations may complete before vscode.git observes the ref change.
  function invalidate(root) {
    if (disposed || !root) return;
    root = key(root);
    versions.set(root, version(root) + 1);
    for (const listener of listeners) listener({ root, version: version(root) });
  }
  function detach(repository) {
    const record = records.get(repository);
    if (!record) return;
    clearTimeout(record.timer);
    record.subscription.dispose();
    records.delete(repository);
    rootsChanged();
  }
  function attach(repository) {
    if (records.has(repository)) return;
    const root = key(repository.rootUri.fsPath);
    const record: {
      identity: string;
      subscription?: { dispose(): void };
      timer?: ReturnType<typeof setTimeout>;
    } = { identity: historyIdentity(repository.state) };
    record.subscription = repository.state.onDidChange(() => {
      const identity = historyIdentity(repository.state);
      if (identity === record.identity) return;
      record.identity = identity;
      versions.set(root, version(root) + 1);
      clearTimeout(record.timer);
      record.timer = setTimeout(() => {
        for (const listener of listeners) listener({ root, version: version(root) });
      }, delay);
    });
    records.set(repository, record);
    rootsChanged();
  }
  function disconnect() {
    apiSubscriptions.forEach((item) => item.dispose());
    apiSubscriptions = [];
    for (const repository of records.keys()) detach(repository);
  }
  const ready = (async () => {
    const extension = vscode.extensions.getExtension?.('vscode.git');
    if (!extension) return;
    const git = await extension.activate();
    if (disposed) return;
    const connect = () => {
      disconnect();
      if (!git.enabled || disposed) return;
      const api = git.getAPI(1);
      apiSubscriptions = [api.onDidOpenRepository(attach), api.onDidCloseRepository(detach)];
      api.repositories.forEach(attach);
    };
    subscriptions.push(git.onDidChangeEnablement(connect));
    connect();
  })().catch((error) => report(`Repository refresh unavailable: ${error.message}`));
  return {
    ready,
    version,
    invalidate,
    roots: () => [
      ...new Set([...records.keys()].map((repository) => key(repository.rootUri.fsPath))),
    ],
    subscribeRoots(listener) {
      rootListeners.add(listener);
      return { dispose: () => rootListeners.delete(listener) };
    },
    matches: (root, other) => Boolean(root && other && key(root) === key(other)),
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    dispose() {
      disposed = true;
      disconnect();
      subscriptions.forEach((item) => item.dispose());
      listeners.clear();
      rootListeners.clear();
    },
  };
}
export { createRepositoryEvents, historyIdentity, repositoryKey };
