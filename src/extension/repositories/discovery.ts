import * as path from 'node:path';
import type * as VSCode from 'vscode';
import type { createRepositoryEvents } from './events';
import type { git as gitClient } from '../git/client';
import { repositoryKey } from './events';
async function workspaceRepositories(
  vscode: typeof VSCode,
  monitor: ReturnType<typeof createRepositoryEvents>,
  git: typeof gitClient,
): Promise<string[]> {
  await monitor.ready;
  const folders = vscode.workspace.workspaceFolders || [];
  const folderRoots = await Promise.all(
    folders.map((folder) =>
      git(folder.uri.fsPath, ['rev-parse', '--show-toplevel'])
        .then((value) => repositoryKey(value.trim()))
        .catch(() => undefined),
    ),
  );
  const roots: string[] = [];
  for (let index = 0; index < folders.length; index++) {
    if (folderRoots[index]) roots.push(folderRoots[index]);
    const folder = repositoryKey(folders[index].uri.fsPath);
    roots.push(
      ...monitor.roots().filter((root) => {
        const relative = path.relative(folder, root);
        return (
          relative === '' ||
          (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
        );
      }),
    );
  }
  return [...new Set(roots)];
}
function repositoryLabels(roots: string[]) {
  return roots.map((root) => ({
    root,
    name:
      roots.filter((other) => path.basename(other) === path.basename(root)).length > 1
        ? root
        : path.basename(root),
  }));
}
export { workspaceRepositories, repositoryLabels };
