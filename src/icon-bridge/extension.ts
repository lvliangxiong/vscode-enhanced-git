const vscode = require('vscode');
const { createThemeResolver } = require('../extension/icons/theme');
import { createSyntaxResolver } from '../extension/syntax/resolver';
export const activate = (context) => {
  const resolver = createThemeResolver(vscode);
  const syntax = createSyntaxResolver(vscode);
  const changed = () => {
    resolver.reset();
    syntax.reset();
    void vscode.commands.executeCommand('vscode-git.icons.changed').then(undefined, () => {});
    void vscode.commands.executeCommand('vscode-git.syntax.changed').then(undefined, () => {});
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-git.icons.resolve', (request) =>
      resolver.resolve(request),
    ),
    vscode.commands.registerCommand('vscode-git.syntax.snapshot', (request) =>
      syntax.snapshot(request),
    ),
    vscode.commands.registerCommand('vscode-git.syntax.grammar', (scope) => syntax.grammar(scope)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('workbench.iconTheme') ||
        event.affectsConfiguration('files.associations') ||
        event.affectsConfiguration('workbench.colorTheme') ||
        event.affectsConfiguration('editor.tokenColorCustomizations')
      )
        changed();
    }),
    vscode.window.onDidChangeActiveColorTheme(changed),
    vscode.extensions.onDidChange(changed),
  );
};
