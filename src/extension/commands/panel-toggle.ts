import type * as VSCode from 'vscode';

/** Keep a focus handoff/repeated dispatch from toggling the panel back immediately. */
export function registerComparisonPanelToggle(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
) {
  const visible = new Set<VSCode.WebviewPanel>();
  let pending: Promise<unknown> | undefined;
  let release: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-enhanced-git.toggleComparisonPanel', () => {
      if (pending) return pending;
      const operation = Promise.resolve().then(() =>
        vscode.commands.executeCommand('workbench.action.togglePanel'),
      );
      pending = operation;
      void operation
        .finally(() => {
          if (disposed) return;
          // The native panel focus handoff can enqueue a second shortcut dispatch.
          release = setTimeout(() => {
            pending = undefined;
          }, 150);
        })
        .catch(() => {});
      return operation;
    }),
  );
  const publish = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'vscode-enhanced-git.comparisonVisible',
      visible.size > 0,
    );
  };
  context.subscriptions.push({
    dispose() {
      disposed = true;
      clearTimeout(release);
      visible.clear();
      publish();
    },
  });
  return {
    track(panel: VSCode.WebviewPanel) {
      const update = () => {
        if (panel.visible) visible.add(panel);
        else visible.delete(panel);
        publish();
      };
      const changed = panel.onDidChangeViewState(update);
      const closed = panel.onDidDispose(() => {
        visible.delete(panel);
        changed.dispose();
        closed.dispose();
        publish();
      });
      context.subscriptions.push(changed, closed);
      update();
    },
  };
}
