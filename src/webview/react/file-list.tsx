import { NativeFileIcon } from './native-file-icon';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { buildFileTree, type FileTree, type FileListEntry } from './file-tree';
export type { FileListEntry } from './file-tree';

export interface FileListProps {
  files: readonly FileListEntry[];
  directoryView: boolean;
  hasSelection: boolean;
  emptyMessage?: string;
  selectedFile?: number;
  showFolderCounts?: boolean;
  folderOpen: ReadonlyMap<string, boolean>;
  setIcon: (node: HTMLElement, path: string) => void;
  onSelect: (file: FileListEntry) => void;
  onOpen: (file: FileListEntry) => void;
  onOpenWorkingFile?: (file: FileListEntry) => void;
  onFolderChange: (path: string, open: boolean) => void;
  onFolderMount?: (path: string, node: HTMLDetailsElement) => (() => void) | void;
}

/** The icon service owns this span's theme classes; React owns its lifetime. */
function FileIcon({ path, setIcon }: Pick<FileListProps, 'setIcon'> & { path: string }) {
  const node = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (node.current) setIcon(node.current, path);
  }, [path, setIcon]);
  return <span ref={node} aria-hidden="true" />;
}

const FileRow = memo(
  function FileRow({
    file,
    flat = false,
    props,
  }: {
    file: FileListEntry;
    flat?: boolean;
    props: FileListProps;
  }) {
    const status = file.status[0];
    const statusName =
      (
        {
          A: 'Added',
          M: 'Modified',
          D: 'Deleted',
          R: 'Renamed',
          C: 'Copied',
          T: 'Type changed',
          U: 'Unmerged',
        } as Record<string, string>
      )[status] || file.status;
    return (
      <div
        className={`file-row status-${status}${props.selectedFile === file.index ? ' selected' : ''}`}
      >
        <button
          className={`file status-${file.status}${props.selectedFile === file.index ? ' selected' : ''}`}
          title={file.path}
          data-index={file.index}
          aria-label={`${file.status} ${file.path}`}
          onClick={() => props.onSelect(file)}
          onDoubleClick={() => props.onOpen(file)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              props.onOpen(file);
            }
          }}
        >
          <FileIcon path={file.path} setIcon={props.setIcon} />
          <span className="file-name">{file.path.split('/').pop()}</span>
          {flat && file.path.includes('/') && (
            <span className="file-directory">{file.path.slice(0, file.path.lastIndexOf('/'))}</span>
          )}
        </button>
        <span className="file-actions">
          {props.onOpenWorkingFile && (
            <button
              type="button"
              className="file-open"
              title="Open File"
              aria-label={`Open File: ${file.path}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenWorkingFile?.(file);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <NativeFileIcon name="go-to-file" />
            </button>
          )}
          <span className="file-status" title={statusName} aria-label={statusName}>
            {status}
          </span>
        </span>
      </div>
    );
  },
  (previous, next) =>
    previous.file === next.file &&
    previous.flat === next.flat &&
    (previous.props.selectedFile === previous.file.index) ===
      (next.props.selectedFile === next.file.index) &&
    previous.props.setIcon === next.props.setIcon &&
    previous.props.onSelect === next.props.onSelect &&
    previous.props.onOpen === next.props.onOpen &&
    previous.props.onOpenWorkingFile === next.props.onOpenWorkingFile,
);

function FolderRows({
  tree,
  prefix = '',
  props,
}: {
  tree: FileTree;
  prefix?: string;
  props: FileListProps;
}) {
  return (
    <>
      {[...tree.dirs]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([part, child]) => {
          let label = part,
            current = child,
            path = prefix + part;
          while (!current.files.length && current.dirs.size === 1) {
            const [name, next] = [...current.dirs][0];
            label += '/' + name;
            path += '/' + name;
            current = next;
          }
          return (
            <Folder key={path} path={path} props={props}>
              <summary title={props.showFolderCounts === false ? undefined : path}>
                <span className="folder-chevron native-file-chevron" aria-hidden="true">
                  <NativeFileIcon name="chevron-right" />
                </span>
                <span className="folder-name">{label}</span>
                {props.showFolderCounts !== false && (
                  <span className="folder-count">{current.count} files</span>
                )}
              </summary>
              <FolderRows tree={current} prefix={path + '/'} props={props} />
            </Folder>
          );
        })}
      {tree.files.map((file) => (
        <FileRow key={file.index} file={file} props={props} />
      ))}
    </>
  );
}

function Folder({
  path,
  props,
  children,
}: {
  path: string;
  props: FileListProps;
  children: import('react').ReactNode;
}) {
  const node = useRef<HTMLDetailsElement>(null);
  const open = props.folderOpen.get(path) ?? true;
  useLayoutEffect(() => {
    if (node.current && node.current.open !== open) node.current.open = open;
  });
  const { onFolderMount } = props;
  useLayoutEffect(() => {
    if (node.current) return onFolderMount?.(path, node.current);
  }, [path, onFolderMount]);
  return (
    <details
      ref={node}
      className="file-folder"
      open={open}
      onToggle={(event) => props.onFolderChange(path, event.currentTarget.open)}
    >
      {children}
    </details>
  );
}

export function FileList(props: FileListProps) {
  const tree = useMemo(() => buildFileTree(props.files), [props.files]);
  if (props.emptyMessage || !props.files.length) {
    return (
      <p className="empty">
        {props.emptyMessage ||
          (props.hasSelection
            ? 'No changes in selected commits.'
            : 'Select commit to view changes')}
      </p>
    );
  }
  return props.directoryView ? (
    <FolderRows tree={tree} props={props} />
  ) : (
    <>
      {props.files.map((file) => (
        <FileRow key={file.index} file={file} flat props={props} />
      ))}
    </>
  );
}
