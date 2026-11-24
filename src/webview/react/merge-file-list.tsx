import { NativeFileIcon } from './native-file-icon';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ParentChanges } from '../../shared/model';
import { FileList, type FileListProps } from './file-list';
import { mergeFileGroupPath } from './file-tree';
import { Icon } from './log-chrome';
import { comparisonLabels } from '../../shared/comparison-labels';

function MergeGroup({
  path,
  label,
  children,
  props,
  parent = false,
  action,
}: {
  path: string;
  label: ReactNode;
  children: ReactNode;
  props: FileListProps;
  parent?: boolean;
  action?: ReactNode;
}) {
  const node = useRef<HTMLDetailsElement>(null);
  const open = props.folderOpen.get(path) ?? true;
  useLayoutEffect(() => {
    if (node.current && node.current.open !== open) node.current.open = open;
  });
  return (
    <details
      ref={node}
      className={`file-folder merge-file-group${parent ? ' merge-parent-group' : ''}`}
      open={open}
      onToggle={(event) => props.onFolderChange(path, event.currentTarget.open)}
    >
      <summary>
        <span className="folder-chevron native-file-chevron" aria-hidden="true">
          <NativeFileIcon name="chevron-right" />
        </span>
        {label}
        {action}
      </summary>
      {children}
    </details>
  );
}

/** All selected changes share a file-count root above optional parent comparisons. */
export function MergeFileList({
  parents,
  showParentChanges,
  onShowParents,
  onShowParentDiff,
  ...props
}: FileListProps & {
  parents: readonly ParentChanges[];
  showParentChanges: boolean;
  onShowParents: () => void;
  onShowParentDiff?: (hash: string) => void;
}) {
  if (props.emptyMessage || (!parents.length && !props.files.length))
    return <FileList {...props} />;
  return (
    <>
      {props.files.length ? (
        <MergeGroup
          path={mergeFileGroupPath()}
          props={props}
          label={
            <>
              <span className="rebased-icon rebased-folder file-group-icon" aria-hidden="true" />
              <span className="folder-count">
                {props.files.length} {props.files.length === 1 ? 'file' : 'files'}
              </span>
            </>
          }
        >
          <FileList {...props} />
        </MergeGroup>
      ) : (
        <p className={showParentChanges ? 'merge-empty merge-empty-row' : 'empty merge-empty'}>
          {showParentChanges && (
            <span className="folder-chevron rebased-icon merge-empty-chevron" aria-hidden="true" />
          )}
          No merge conflicts.
          {!showParentChanges && (
            <button className="merge-parent-link" onClick={onShowParents}>
              Show Changes to Parents
            </button>
          )}
        </p>
      )}
      {showParentChanges &&
        parents.map(
          (parent) =>
            parent.files.length > 0 && (
              <MergeGroup
                key={parent.hash}
                parent
                path={mergeFileGroupPath(parent.hash)}
                props={props}
                label={<span className="folder-name">Changes to {parent.hash.slice(0, 8)}</span>}
                action={
                  onShowParentDiff && (
                    <button
                      type="button"
                      className="merge-parent-diff"
                      title={comparisonLabels.files}
                      aria-label={`${comparisonLabels.files}: ${parent.hash.slice(0, 8)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onShowParentDiff(parent.hash);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <Icon name="fileDiff" />
                    </button>
                  )
                }
              >
                <FileList {...props} files={parent.files} />
              </MergeGroup>
            ),
        )}
    </>
  );
}
