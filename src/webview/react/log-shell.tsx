import { comparisonLabels } from '../../shared/comparison-labels';
import { useContext, useLayoutEffect } from 'react';
import { UiContext, useSession, useSessionState } from './session-context';
import {
  Button,
  BranchRail,
  SearchInput,
  HeadBranch,
  Slot,
  HistoryToolbar,
  MoreCommits,
  Footer,
} from './log-chrome';
import { Menu } from './action-menu';
import { Hover, RefDialog } from './session-overlays';
export function LogShell() {
  const { env } = useContext(UiContext);
  const ctx = useSession();
  const state = useSessionState([
    'branchesCollapsed',
    'detailsCollapsed',
    'showDetails',
    'showPreview',
    'previewLocation',
  ]);
  useLayoutEffect(() => {
    ctx?.actions.layout.applyDetailLayout();
  }, [
    ctx,
    state?.branchesCollapsed,
    state?.detailsCollapsed,
    state?.showDetails,
    state?.showPreview,
    state?.previewLocation,
  ]);
  return (
    <>
      <main
        id="layout"
        className={state?.showPreview ? `preview-${state.previewLocation}` : undefined}
      >
        <aside
          id="branch-pane"
          aria-label="Git branches"
          className={state?.branchesCollapsed ? 'branches-collapsed' : undefined}
        >
          <BranchRail />
          <div id="branch-content" hidden={state?.branchesCollapsed}>
            <div className="branch-toolbar">
              <div className="search-box branch-search">
                <span className="search-icon rebased-icon rebased-search" aria-hidden="true" />
                <SearchInput branch />
                <Button
                  id="branches-clear"
                  className="search-clear"
                  label="Clear branch search"
                  hidden
                />
              </div>
            </div>
            <HeadBranch />
            <div id="branches">
              <Slot name="branches" />
            </div>
          </div>
        </aside>
        <div
          id="split-left"
          hidden={Boolean(env.comparison) || state?.branchesCollapsed}
          className="splitter"
          role="separator"
          aria-label="Branches width"
          aria-orientation="vertical"
          tabIndex={0}
        />
        <section id="history">
          <HistoryToolbar />
          {env.comparison && (
            <div className="comparison-explanation">
              Commits that exist in <strong>{env.comparison.end.name}</strong>
              {" but don't exist in "}
              <strong>{env.comparison.start.name}</strong>
            </div>
          )}
          <div
            className="commit-table"
            id="commits"
            role="listbox"
            aria-label="Commits"
            aria-multiselectable="true"
          >
            <Slot name="commits" />
          </div>
          <MoreCommits />
        </section>
        <div
          id="split-right"
          hidden={state?.detailsCollapsed}
          className="splitter"
          role="separator"
          aria-label="Details width"
          aria-orientation="vertical"
          tabIndex={0}
        />
        <section id="detail" className={state?.detailsCollapsed ? 'details-collapsed' : undefined}>
          <Button
            id="details-expand"
            className="details-stripe"
            label="Show Files and Commit Details"
            icon="left"
            hidden={!state?.detailsCollapsed}
          >
            <span aria-hidden="true">Details</span>
          </Button>
          <div
            className="detail-toolbar"
            role="toolbar"
            aria-label="Changed files"
            hidden={state?.detailsCollapsed}
          >
            <Button id="files-sidebar" label={comparisonLabels.files} icon="fileDiff" disabled />
            <Button id="files-history" label="History Up To Here" icon="history" disabled />
            <Button id="files-options" label="File View Options" icon="show" aria-haspopup="menu" />
            <Button id="files-expansion" label="Collapse All" icon="collapse" disabled />
            <Button id="details-toggle" label="Hide Files and Commit Details" icon="right" />
          </div>
          <div id="files" hidden={state?.detailsCollapsed}>
            <Slot name="files" />
          </div>
          <div
            id="split-detail"
            hidden={state?.showDetails === false || state?.detailsCollapsed}
            className="splitter horizontal-splitter"
            role="separator"
            aria-label="Files and commit details height"
            aria-controls="files message"
            aria-orientation="horizontal"
            tabIndex={0}
          />
          <div id="message" hidden={state?.showDetails === false || state?.detailsCollapsed}>
            <Slot name="message" />
          </div>
        </section>
        <div id="preview" hidden={!state?.showPreview}>
          <Slot name="preview" />
        </div>
        <button
          id="split-junction"
          hidden={state?.showDetails === false || state?.detailsCollapsed}
          className="split-junction"
          aria-label="Resize commit list, files and details"
          title="Drag to resize all three areas; double-click to reset"
        />
      </main>
      <Footer />
      <section id="filter-popup" role="dialog" aria-modal="false" hidden>
        <Slot name="filter" />
      </section>
      <Menu id="branch-menu" />
      <Menu id="view-menu" />
      <Menu id="files-menu" />
      <Hover id="commit-hover" />
      <Hover id="branch-hover" />
      <Hover id="recent-hover" />
      <Hover id="toolbar-tooltip" />
      <RefDialog />
    </>
  );
}
