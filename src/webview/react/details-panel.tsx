import { useSyncExternalStore } from 'react';
import type { LogContext } from '../log/context';
import { CommitDetails } from './commit-details';
import { MergeFileList } from './merge-file-list';

function useDetails(ctx: LogContext) {
  const store = ctx.actions.files.store;
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function FilesContent({ ctx }: { ctx: LogContext }) {
  const state = useDetails(ctx);
  const selected = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getState().selected.size,
    () => ctx.store.getState().selected.size,
  );
  const actions = ctx.actions.files;
  return (
    <MergeFileList
      files={state.files}
      parents={state.parents}
      showParentChanges={state.showParentChanges}
      onShowParents={actions.toggleParentChanges}
      onShowParentDiff={actions.showParentDiff}
      directoryView={state.directoryView}
      hasSelection={Boolean(selected)}
      emptyMessage={state.emptyMessage}
      selectedFile={state.selectedFile}
      folderOpen={state.opened}
      setIcon={actions.setIcon}
      onSelect={actions.selectFile}
      onOpen={actions.openFile}
      onOpenWorkingFile={actions.openWorkingFile}
      onFolderChange={actions.setFolder}
    />
  );
}

export function MessageContent({ ctx }: { ctx: LogContext }) {
  const state = useDetails(ctx);
  const actions = ctx.actions.details;
  return (
    <CommitDetails
      items={state.items}
      onOpenLink={actions.openLink}
      onShowChanges={actions.showChanges}
      onCopy={actions.copy}
    />
  );
}

export function PreviewContent({ ctx }: { ctx: LogContext }) {
  const state = useDetails(ctx);
  if (state.previewLoading) return <p className="empty">Loading Diff…</p>;
  if (state.previewText === undefined) return null;
  return (
    <pre className="patch">
      {state.previewText.split('\n').map((line, index) => (
        <span
          key={index}
          className={
            line.startsWith('+')
              ? 'addition'
              : line.startsWith('-')
                ? 'deletion'
                : line.startsWith('@@')
                  ? 'hunk'
                  : ''
          }
        >
          {line}
        </span>
      ))}
    </pre>
  );
}

export function FileCount({ ctx }: { ctx: LogContext }) {
  return <>{useDetails(ctx).files.length} files</>;
}
