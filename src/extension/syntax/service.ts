import type * as VSCode from 'vscode';
import { createSyntaxResolver } from './resolver';
import type { SyntaxSnapshot } from '../../shared/syntax';

const services = new WeakMap<VSCode.ExtensionContext, ReturnType<typeof createService>>();
export function mergeSyntaxService(vscode: typeof VSCode, context: VSCode.ExtensionContext) {
  // Older or deliberately minimal test hosts can retain Monaco's built-in fallback.
  if (!vscode.workspace || !vscode.extensions) return undefined;
  if (!services.has(context)) services.set(context, createService(vscode, context));
  return services.get(context);
}
function createService(vscode: typeof VSCode, context: VSCode.ExtensionContext) {
  const resolver = createSyntaxResolver(vscode);
  const listeners = new Set<() => void>();
  const changed = () => {
    resolver.reset();
    for (const listener of listeners) listener();
  };
  const subscriptions = [
    vscode.commands.registerCommand('vscode-git.syntax.changed', changed),
    vscode.window.onDidChangeActiveColorTheme(changed),
    vscode.extensions.onDidChange(changed),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        ['workbench.colorTheme', 'editor.tokenColorCustomizations', 'files.associations'].some(
          (key) => event.affectsConfiguration(key),
        )
      )
        changed();
    }),
  ];
  context.subscriptions?.push(...subscriptions);
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    async snapshot(file: string, theme?: string): Promise<SyntaxSnapshot> {
      const uri = vscode.Uri.file(file);
      const request = {
        path: file,
        theme,
        customizations: vscode.workspace
          .getConfiguration('editor', uri)
          .get('tokenColorCustomizations', {}),
        associations: vscode.workspace.getConfiguration('files', uri).get('associations', {}),
      };
      if (!vscode.env.remoteName) return resolver.snapshot(request);
      const local = await vscode.commands.executeCommand<SyntaxSnapshot>(
        'vscode-git.syntax.snapshot',
        request,
      );
      const remote = await resolver.snapshot(request);
      return {
        ...local,
        language: remote.language || local.language,
        grammars: [
          ...local.grammars.filter(
            (item) => !remote.grammars.some((other) => item.scopeName === other.scopeName),
          ),
          ...remote.grammars,
        ],
      };
    },
    async grammar(scope: string) {
      return (
        (await resolver.grammar(scope)) ||
        (vscode.env.remoteName
          ? vscode.commands.executeCommand('vscode-git.syntax.grammar', scope)
          : null)
      );
    },
  };
}
