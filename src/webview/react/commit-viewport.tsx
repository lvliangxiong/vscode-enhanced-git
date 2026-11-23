import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { LogState } from '../state/log';
import { CommitList, type CommitListProps } from './commit-list';

/** Viewport models are expensive geometry; selection and columns are cheap store selectors. */
export function CommitViewport({
  model,
  session,
}: {
  model: StoreApi<CommitListProps>;
  session: StoreApi<LogState>;
}) {
  const viewport = useStore(model);
  const selected = useStore(session, (state) => state.selected);
  const order = useStore(session, (state) => state.columnOrder);
  const settings = useStore(session, (state) => state.viewSettings);
  const columns = useMemo(
    () => order.filter((key) => key === 'subject' || settings[key]),
    [order, settings],
  );
  const rows = useMemo(
    () =>
      viewport.rows.map((row) => ({ ...row, selected: selected.has(row.commit.hash), columns })),
    [viewport.rows, selected, columns],
  );
  return <CommitList {...viewport} rows={rows} hostSubjectHover />;
}
