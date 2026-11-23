import type { FileChange } from '../../shared/model';

export type FileListEntry = Pick<FileChange, 'index' | 'status' | 'path'>;

/** NUL cannot occur in Git paths, keeping UI group state separate from directories. */
export const mergeFileGroupPath = (parent?: string) =>
  '\0merge/' + (parent ? `parent/${parent}` : 'combined');
export interface FileTree {
  dirs: Map<string, FileTree>;
  files: FileListEntry[];
  count: number;
}

export function buildFileTree(files: readonly FileListEntry[]): FileTree {
  const root: FileTree = { dirs: new Map(), files: [], count: 0 };
  for (const file of files) {
    let node = root;
    node.count++;
    for (const part of file.path.split('/').slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [], count: 0 });
      node = node.dirs.get(part)!;
      node.count++;
    }
    node.files.push(file);
  }
  return root;
}

/** The model and React tree share compact-folder paths, without querying mounted DOM. */
export function fileFolderPaths(files: readonly FileListEntry[]): string[] {
  const paths: string[] = [];
  function visit(tree: FileTree, prefix = '') {
    for (const [part, child] of tree.dirs) {
      let current = child;
      let path = prefix + part;
      while (!current.files.length && current.dirs.size === 1) {
        const [name, next] = [...current.dirs][0];
        path += '/' + name;
        current = next;
      }
      paths.push(path);
      visit(current, path + '/');
    }
  }
  visit(buildFileTree(files));
  return paths;
}
