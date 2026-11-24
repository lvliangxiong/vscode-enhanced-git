import { createThemeResolver } from './theme';
function createIconThemeService(vscode, context) {
  const resolver = createThemeResolver(vscode),
    listeners = new Set<() => void>();
  const changed = () => {
    resolver.reset();
    for (const listener of listeners) listener();
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-git.icons.changed', changed),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('workbench.iconTheme') ||
        event.affectsConfiguration('files.associations')
      )
        changed();
    }),
    vscode.window.onDidChangeActiveColorTheme(changed),
    vscode.extensions.onDidChange(changed),
  );
  return {
    async handle(message, post, root) {
      if (message.type !== 'fileIcons') return false;
      const request = {
        entries: message.entries,
        languages: vscode.extensions.all.flatMap((extension) =>
          (extension.packageJSON.contributes?.languages || []).map(
            ({ id, extensions, filenames, filenamePatterns }) => ({
              id,
              extensions,
              filenames,
              filenamePatterns,
            }),
          ),
        ),
        associations: vscode.workspace
          .getConfiguration('files', root ? vscode.Uri.file(root) : undefined)
          .get('associations', {}),
      };
      try {
        const result = vscode.env.remoteName
          ? await vscode.commands.executeCommand('vscode-git.icons.resolve', request)
          : await resolver.resolve(request);
        await post({
          type: 'fileIcons',
          request: message.request,
          generation: message.generation,
          ...result,
        });
      } catch (error) {
        await post({
          type: 'fileIcons',
          request: message.request,
          generation: message.generation,
          unavailable: true,
        });
        console.warn('VS Code Git file icon theme:', error.message);
      }
      return true;
    },
    subscribe(callback) {
      listeners.add(callback);
      return { dispose: () => listeners.delete(callback) };
    },
  };
}
export { createIconThemeService };
