import type * as VSCode from 'vscode';
import { git, validHash } from '../git/client';
import { selectionDetails } from '../git/changes';
import type { ChangesContent } from '../../shared/model';

/** Use the same root/merge/rename-aware selection reader as Git Log's File Diffs action. */
export async function commitFileDiffs(root: string, hash: string): Promise<ChangesContent> {
  validHash(hash);
  const result = await selectionDetails(root, [hash], { includeStats: false });
  return {
    kind: 'selection',
    commits: [{ hash, subject: result.items[0].message.split('\n')[0] }],
    files: result.files,
  };
}

interface GitRepository {
  rootUri: VSCode.Uri;
}
interface GitApi {
  registerSourceControlHistoryItemDetailsProvider?(provider: {
    provideAvatar(): undefined;
    provideMessageLinks(): undefined;
    provideHoverCommands(repository: GitRepository): VSCode.Command[];
  }): VSCode.Disposable;
}
interface GitExtension {
  enabled: boolean;
  getAPI(version: 1): GitApi;
  onDidChangeEnablement(listener: () => void): VSCode.Disposable;
}

/** Native Git appends the hovered commit hash to each provider command's arguments. */
export function registerCommitFileDiffs(
  vscode: typeof VSCode,
  context: VSCode.ExtensionContext,
  show: (root: string, load: () => Promise<ChangesContent>) => Promise<void>,
  report: (message: string) => void,
  locate?: (root: string, hash: string) => Promise<void>,
) {
  let disposed = false;
  let provider: VSCode.Disposable | undefined;
  let enablement: VSCode.Disposable | undefined;
  context.subscriptions.push({
    dispose() {
      disposed = true;
      provider?.dispose();
      enablement?.dispose();
    },
  });
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vscode-enhanced-git.showCommitFileDiffs',
      async (uri: VSCode.Uri, hash: string) => {
        try {
          if (!uri || !['file', 'vscode-remote'].includes(uri.scheme))
            throw new Error('Choose a repository commit.');
          validHash(hash);
          const root = (await git(uri.fsPath, ['rev-parse', '--show-toplevel'])).trim();
          await show(root, () => commitFileDiffs(root, hash));
        } catch (error) {
          void vscode.window.showErrorMessage(`Enhanced Git: ${error.message}`);
        }
      },
    ),
  );
  if (locate)
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'vscode-enhanced-git.locateCommit',
        async (uri: VSCode.Uri, hash: string) => {
          try {
            if (!uri || !['file', 'vscode-remote'].includes(uri.scheme))
              throw new Error('Choose a repository commit.');
            validHash(hash);
            const root = (await git(uri.fsPath, ['rev-parse', '--show-toplevel'])).trim();
            await locate(root, hash);
          } catch (error) {
            void vscode.window.showErrorMessage(`Enhanced Git: ${error.message}`);
          }
        },
      ),
    );
  const ready = (async () => {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) return;
    const exports = await extension.activate();
    if (disposed) return;
    const connect = () => {
      provider?.dispose();
      provider = undefined;
      if (!exports.enabled || disposed) return;
      provider = exports.getAPI(1).registerSourceControlHistoryItemDetailsProvider?.({
        provideAvatar: () => undefined,
        provideMessageLinks: () => undefined,
        provideHoverCommands: (repository) => [
          {
            title: '$(diff-multiple) Show File Diffs',
            tooltip: 'Show this commit’s changed files in File Diffs',
            command: 'vscode-enhanced-git.showCommitFileDiffs',
            arguments: [repository.rootUri],
          },
          ...(locate
            ? [
                {
                  title: '$(target) Locate in Git Log',
                  tooltip: 'Locate this commit in the bottom Git Log graph',
                  command: 'vscode-enhanced-git.locateCommit',
                  arguments: [repository.rootUri],
                },
              ]
            : []),
        ],
      });
    };
    enablement = exports.onDidChangeEnablement(connect);
    connect();
  })().catch((error) => report(`Commit hover integration unavailable: ${error.message}`));
  return { ready };
}
