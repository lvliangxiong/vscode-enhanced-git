import { comparisonLabels } from '../../shared/comparison-labels';
import type { WebviewApi } from '../api';
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { FileList } from './file-list';
import { SelectedCommitSummary } from './selected-commit-summary';
import {
  createComparisonStore,
  type ComparisonController,
  type SavedComparisonState,
} from '../state/comparison';

export interface ChangesEnvironment {
  document: Document;
  window: Window;
  api: WebviewApi;
  fileIcons: {
    create(options: {
      send: (type: string, message?: object) => void;
      sheet: CSSStyleSheet;
      document?: Document;
      window?: Window;
    }): {
      set(node: HTMLElement, path: string): void;
      dispose?(): void;
    };
  };
}

/** One sidebar application. Host messages update its model; React owns every visible node. */
function ChangesApp({
  env,
  controller,
}: {
  env: ChangesEnvironment;
  controller: ComparisonController;
}) {
  const state = useSyncExternalStore(
    controller.store.subscribe,
    controller.store.getState,
    controller.store.getState,
  );
  const list = useRef<HTMLDivElement>(null);
  const reportSignature = useRef('');
  const previous = useRef(state);
  const persistenceFrame = useRef(0);
  const send = useMemo(
    () =>
      (type: string, message: object = {}) =>
        env.api.postMessage({ type, ...message }),
    [env],
  );
  const icons = useMemo(
    () =>
      env.fileIcons.create({
        send,
        sheet: (env.document.getElementById('layout-style') as HTMLStyleElement).sheet!,
        document: env.document,
        window: env.window,
      }),
    [env, send],
  );
  useLayoutEffect(() => () => icons.dispose?.(), [icons]);
  const setIcon = useMemo(
    () => (node: HTMLElement, path: string) => icons.set(node, path),
    [icons],
  );
  const persist = useCallback(() => {
    env.window.cancelAnimationFrame(persistenceFrame.current);
    persistenceFrame.current = 0;
    const current = controller.store.getState();
    env.api.setState({
      tree: current.tree,
      opened: [...current.opened],
      id: current.data?.id,
      chosen: current.chosen,
      scroll: list.current?.scrollTop || 0,
    });
  }, [env, controller]);
  const schedulePersist = useCallback(() => {
    if (!persistenceFrame.current)
      persistenceFrame.current = env.window.requestAnimationFrame(persist);
  }, [env, persist]);
  const actions = useMemo(
    () => ({
      onSelect: (file: { index: number }) => controller.select(file.index),
      onOpen: (file: { index: number }) => {
        controller.select(file.index);
        send('branchChangesFile', { id: controller.store.getState().data?.id, index: file.index });
      },
      onOpenWorkingFile: (file: { index: number }) => {
        controller.select(file.index);
        send('branchChangesFile', {
          id: controller.store.getState().data?.id,
          index: file.index,
          workingFile: true,
        });
      },
      onFolderChange: controller.setFolder,
    }),
    [controller, send],
  );
  const files = useMemo(() => {
    const files = state.data?.files || [];
    return state.tree
      ? files
      : [...files].sort((a, b) => a.path.split('/').pop()!.localeCompare(b.path.split('/').pop()!));
  }, [state.data, state.tree]);
  const selection = state.data?.kind === 'selection' ? state.data : undefined;
  const pair = state.data && state.data.kind !== 'selection' ? state.data.pair : undefined;
  const selectedLabel = selection
    ? `${selection.commits.length} selected commit${selection.commits.length === 1 ? '' : 's'}`
    : undefined;
  const workingTree = pair?.some((part) => part.kind === 'workingTree');
  const kind = selection
    ? 'Selected commit'
    : workingTree
      ? 'Working Tree'
      : pair?.every((part) => part.kind === 'commit')
        ? 'Commit'
        : 'Branch';

  useLayoutEffect(() => {
    if (
      state.revision !== previous.current.revision &&
      state.restoreScroll !== undefined &&
      list.current
    )
      list.current.scrollTop = state.restoreScroll;
    const hasFolders = state.tree && state.folders.length > 0;
    const report = {
      id: state.data?.id,
      tree: state.tree,
      hasFolders,
      expanded: hasFolders && state.folders.every((path) => state.opened.get(path) !== false),
    };
    const signature = JSON.stringify(report);
    if (signature !== reportSignature.current) {
      reportSignature.current = signature;
      send('comparisonState', report);
    }
    if (state.revision !== previous.current.revision) persist();
    else if (state !== previous.current) schedulePersist();
    previous.current = state;
  }, [state, send, persist, schedulePersist]);
  useLayoutEffect(() => () => env.window.cancelAnimationFrame(persistenceFrame.current), [env]);
  useLayoutEffect(() => {
    const drawer = env.document.getElementById('changes')!;
    drawer.setAttribute(
      'aria-label',
      selection
        ? 'File Diffs for Selected Commits'
        : workingTree
          ? 'File Diffs with Working Tree'
          : `File Diffs between ${kind === 'Commit' ? 'Commits' : 'Branches'}`,
    );
    drawer.title = state.data
      ? [
          'Provided by the Enhanced Git extension',
          selection ? selectedLabel : `File Diffs: ${pair![0].name} ↔ ${pair![1].name}`,
          state.data.repository,
          ...(selection ? selection.commits : pair!).map((part) => part.hash),
        ].join('\n')
      : 'Provided by the Enhanced Git extension';
  }, [env, state.data, workingTree, kind, selection, selectedLabel, pair]);
  return (
    <>
      {selection && <SelectedCommitSummary commits={selection.commits} />}
      <div
        className="branch-changes-files"
        role="tree"
        aria-label={`${kind} changes`}
        ref={list}
        onScroll={schedulePersist}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('.file')].filter(
            (row) => row.getClientRects().length,
          );
          const focusedRow = env.document.activeElement
            ?.closest('.file-row')
            ?.querySelector<HTMLElement>('.file');
          const index = focusedRow ? rows.indexOf(focusedRow) : -1;
          const next =
            rows[
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? rows.length - 1
                  : Math.max(
                      0,
                      Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                    )
            ];
          next?.click();
          next?.focus();
        }}
      >
        {state.data ? (
          <FileList
            files={files}
            directoryView={state.tree}
            hasSelection
            emptyMessage={
              files.length
                ? undefined
                : selection
                  ? 'No changes in selected commits.'
                  : 'No differences.'
            }
            selectedFile={state.chosen}
            folderOpen={state.opened}
            showFolderCounts={false}
            setIcon={setIcon}
            {...actions}
          />
        ) : (
          <div className="changes-welcome sidebar-welcome">
            <p>
              Select two branches or commits in Git Log, then choose “{comparisonLabels.files}”. To
              show the current selection’s file list here, use the same action in the files toolbar.
            </p>
            <button className="open-git-log" onClick={() => send('openGitLog')}>
              Open Git Log
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function mountChanges(env: ChangesEnvironment) {
  const controller = createComparisonStore(env.api.getState() as SavedComparisonState);
  const root = createRoot(env.document.getElementById('changes')!);
  let disposed = false;
  const receive = ({ data }: MessageEvent) => {
    if (disposed) return;
    flushSync(() => {
      if (data.type === 'branchChanges' || data.type === 'selectionChanges')
        controller.receive(data, (env.api.getState() as SavedComparisonState) || {});
      else if (data.type === 'comparisonAction') {
        if (data.action === 'tree') controller.setTree(data.tree);
        if (data.action === 'expansion') controller.expand(data.expanded);
      }
    });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    env.window.removeEventListener('message', receive);
    env.window.removeEventListener('unload', dispose);
    env.window.removeEventListener('vsCodeEnhancedGitDispose', dispose);
    flushSync(() => root.unmount());
  };
  env.window.addEventListener('message', receive);
  env.window.addEventListener('unload', dispose);
  env.window.addEventListener('vsCodeEnhancedGitDispose', dispose);
  flushSync(() => root.render(<ChangesApp env={env} controller={controller} />));
  env.api.postMessage({ type: 'ready' });
  return { controller, dispose };
}
