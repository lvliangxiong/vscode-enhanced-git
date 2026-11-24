// A response acknowledges only the repository version captured BEFORE its Git
// reads. Changes arriving during those reads remain pending for another load.
export function create({ canRefresh, refresh, indicate }) {
  let root,
    known = 0,
    applied = 0,
    loading = false,
    failed = false,
    queued = false,
    disposed = false;
  function pending() {
    return known > applied;
  }
  function check() {
    if (disposed) return;
    indicate(pending());
    if (!pending() || loading || failed || !canRefresh() || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed && pending() && !loading && !failed && canRefresh()) refresh();
    });
  }
  return {
    dispose() {
      disposed = true;
    },
    reset(value) {
      if (disposed) return;
      root = value;
      known = applied = 0;
      failed = false;
      indicate(false);
    },
    changed(event) {
      if (disposed || event.root !== root) return;
      known = Math.max(known, event.version);
      failed = false;
      check();
    },
    begin() {
      if (disposed) return;
      loading = true;
      failed = false;
    },
    finish(event) {
      if (disposed || event.root !== root) return;
      loading = false;
      applied = Math.max(applied, event.repositoryVersion || 0);
      check();
    },
    error() {
      if (disposed) return;
      loading = false;
      failed = true;
      indicate(pending());
    },
    check,
  };
}
