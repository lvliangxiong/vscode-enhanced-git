import type * as VSCode from 'vscode';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FileChange } from '../../shared/model';
import { git } from '../git/client';
import { relativePath } from '../git/refs';

export async function openWorkingFile(
  vscode: typeof VSCode,
  root: string,
  change: FileChange,
  snapshots: Map<string, string>,
) {
  const file = relativePath(root, change.after?.path || change.before?.path || change.path);
  const uri = vscode.Uri.file(path.join(root, file));
  try {
    const info = await stat(uri.fsPath);
    if (!info.isFile()) throw new Error('The selected path is not a file.');
    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    const revision = [change.after, change.before].find((side) => side?.hash && !side.workingTree);
    if (!revision) throw new Error('The file no longer exists in the working tree.');
    const text = await git(root, ['show', `${revision.hash}:${revision.path}`]);
    const snapshot = vscode.Uri.from({
      scheme: 'vscode-git',
      path: '/' + revision.path,
      query: new URLSearchParams({ revision: revision.hash, snapshot: randomUUID() }).toString(),
    });
    snapshots.set(snapshot.toString(), text);
    await vscode.commands.executeCommand('vscode.open', snapshot, { preview: false });
  }
}
