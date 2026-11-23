import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { FilterController } from '../filters';
import { FilterMenu, FilterSearch } from './filter-menu';
import { FilterEditor } from './filter-editor';
import { FilterDateDialog, FilterPathDialog } from './filter-dialogs';

/** Mounted once under the log's React root; drafts and submenu lifetime stay local. */
export function FilterSurface({ controller }: { controller: FilterController }) {
  const state = useSyncExternalStore(
    controller.store.subscribe,
    controller.store.getState,
    controller.store.getState,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => controller.start(), [controller]);
  useLayoutEffect(() => {
    const popup = controller.popup;
    popup.hidden = !state.kind;
    popup.className =
      state.mode === 'menu'
        ? 'rebased-filter-menu filter-kind-' + state.kind + (state.query ? ' is-searching' : '')
        : state.mode === 'editor'
          ? 'filter-editor'
          : 'filter-dialog-host';
    popup.setAttribute('role', state.mode === 'menu' ? 'menu' : 'dialog');
    popup.setAttribute(
      'aria-label',
      state.mode === 'menu' ? state.kind + ' filter' : 'Select ' + state.kind,
    );
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    controller.didCommit();
  });
  if (!state.kind) return null;
  const model = controller.model();
  const dialogMode = state.mode === 'date' || state.mode === 'paths';
  return (
    <div
      className="filter-surface"
      onKeyDown={(event) => controller.keyDown(event as unknown as KeyboardEvent)}
    >
      {state.mode === 'menu' && (
        <>
          {state.query && (
            <div className="filter-search-bar">
              <FilterSearch
                kind={state.kind}
                query={state.query}
                activeId={
                  state.entries.some((entry) => !entry.heading && !entry.separator)
                    ? 'filter-result-' + state.activeIndex
                    : undefined
                }
                register={(node) => {
                  controller.dom.search = node;
                }}
                search={controller.query}
                clear={() => controller.query('')}
              />
            </div>
          )}
          <div
            className="filter-menu-body"
            id="filter-results"
            ref={(node) => {
              controller.dom.body = node;
            }}
            onKeyDown={(event) => controller.menuKey(event)}
          >
            <FilterMenu
              {...controller.menuProps()}
              activeIndex={state.query ? state.activeIndex : undefined}
              idPrefix="filter-result-"
              expandedLabel={state.submenuLabel}
            />
          </div>
          {state.submenuLabel && (
            <div
              className="filter-submenu"
              id="filter-submenu"
              role="menu"
              aria-label={state.submenuLabel}
              ref={(node) => {
                controller.dom.submenu = node;
              }}
              onPointerEnter={controller.enterSub}
              onPointerLeave={(event) => controller.leaveSub(event.relatedTarget)}
              onKeyDown={(event) => controller.menuKey(event, true)}
            >
              <FilterMenu {...controller.menuProps(true)} />
            </div>
          )}
        </>
      )}
      {state.mode === 'editor' && (
        <FilterEditor
          kind={state.kind}
          initialValue={controller
            .current()
            .map((value) =>
              state.kind === 'branch'
                ? model.branches.find((branch) => branch.ref === value)?.name || value
                : value,
            )
            .join('\n')}
          choices={
            state.kind === 'branch'
              ? controller.branchItems().map((branch) => branch.name)
              : [
                  'me',
                  ...new Set<string>(
                    model.authorOptions.map((author) => author.name || author.email.split('@')[0]),
                  ),
                ]
          }
          branches={model.branches}
          apply={controller.apply}
          position={controller.position}
        />
      )}
      {dialogMode && (
        <dialog
          ref={dialog}
          className="filter-dialog"
          aria-label={state.mode === 'date' ? 'Select Period' : 'Select Paths to Filter by'}
          onCancel={(event) => {
            event.preventDefault();
            controller.close(true);
          }}
        >
          <h3>{state.mode === 'date' ? 'Select Period' : 'Select Paths to Filter by'}</h3>
          {state.mode === 'date' ? (
            <FilterDateDialog
              since={model.since}
              until={model.until}
              apply={(value) => controller.apply(value, false)}
              close={() => controller.close(true)}
            />
          ) : (
            <FilterPathDialog
              root={model.root}
              paths={model.paths}
              pathChildren={(path) => controller.host.pathChildren(path)}
              fileIcon={controller.host.themeFileIcon.set}
              apply={controller.apply}
              close={() => controller.close(true)}
            />
          )}
        </dialog>
      )}
    </div>
  );
}
