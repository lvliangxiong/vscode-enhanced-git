import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type * as VSCode from 'vscode';
import { git, validHash } from '../git/client';

/** Resolve the repository beside the selected file, including nested repositories/worktrees. */
export async function fileHistoryTarget(filename: string) {
  // Git canonicalizes repository roots (for example /var -> /private/var on macOS).
  // Canonicalize the directory too, while preserving a tracked symlink file's own name.
  const directory = await realpath(path.dirname(filename));
  filename = path.join(directory, path.basename(filename));
  const root = (await git(directory, ['rev-parse', '--show-toplevel'])).trim();
  const revision = validHash((await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim());
  const file = path.relative(root, filename).split(path.sep).join('/');
  if (!file || file === '..' || file.startsWith('../') || path.isAbsolute(file))
    throw new Error('Choose a file inside a Git repository.');
  return { root, revision, file };
}

export async function openFileHistory(
  vscode: typeof VSCode,
  open: (root: string, revision: string, file: string) => Promise<void>,
  uri?: VSCode.Uri,
) {
  uri ??= vscode.window.activeTextEditor?.document.uri;
  if (!uri || !['file', 'vscode-remote'].includes(uri.scheme)) {
    uri = (
      await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Show File History',
      })
    )?.[0];
  }
  if (!uri) return;
  if (!['file', 'vscode-remote'].includes(uri.scheme))
    throw new Error('Choose a repository file to view its history.');
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type & vscode.FileType.Directory) throw new Error('Choose a file to view its history.');
  const target = await fileHistoryTarget(uri.fsPath);
  await open(target.root, target.revision, target.file);
}
