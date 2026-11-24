import type * as VSCode from 'vscode';

export const mergeViewType = 'vscode-git.mergeDiff';
const controllers = new WeakMap<VSCode.ExtensionContext, ReturnType<typeof createController>>();

/** Native editor/title actions route only to the active historical merge view. */
export function mergeActions(vscode: typeof VSCode, context: VSCode.ExtensionContext) {
  if (!controllers.has(context)) controllers.set(context, createController(vscode, context));
  return controllers.get(context);
}
function createController(vscode: typeof VSCode, context: VSCode.ExtensionContext) {
  const views = new Map<
    VSCode.WebviewPanel,
    {
      ready: boolean;
      compare: (parent: 0 | 1) => PromiseLike<unknown>;
      openFile?: () => PromiseLike<unknown>;
    }
  >();
  const active = () => [...views].find(([panel]) => panel.active);
  const update = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'vscode-git.merge.canNavigate',
      !!active()?.[1].ready,
    );
  };
  const run = (action: 'previous' | 'next' | 'openFile' | 0 | 1) => {
    const view = active();
    if (!view) return;
    const [panel, state] = view;
    if (typeof action === 'number') return state.compare(action);
    if (action === 'openFile') return state.openFile?.();
    if (state.ready) return panel.webview.postMessage({ type: 'mergeAction', action });
  };
  for (const [name, action] of [
    ['previous', 'previous'],
    ['next', 'next'],
    ['compareParent1', 0],
    ['compareParent2', 1],
    ['openFile', 'openFile'],
  ] as const)
    context.subscriptions.push(
      vscode.commands.registerCommand('vscode-git.merge.' + name, async () => {
        try {
          await run(action);
        } catch (error) {
          void vscode.window.showErrorMessage(`VS Code Git: ${error.message}`);
        }
      }),
    );
  return {
    attach(
      panel: VSCode.WebviewPanel,
      compare: (parent: 0 | 1) => PromiseLike<unknown>,
      openFile?: () => PromiseLike<unknown>,
    ) {
      const state = { ready: false, compare, openFile };
      views.set(panel, state);
      const listener = panel.onDidChangeViewState(update);
      update();
      return {
        ready(value: boolean) {
          state.ready = value;
          update();
        },
        dispose() {
          listener.dispose();
          views.delete(panel);
          update();
        },
      };
    },
  };
}
