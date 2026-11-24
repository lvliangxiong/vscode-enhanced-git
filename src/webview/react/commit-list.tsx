import { referenceGroups, type ReferenceGroup } from '../../shared/reference-labels';
import { ReferenceLabels } from './reference-labels';
import { memo, useLayoutEffect, useRef } from 'react';
import { CommitSubject } from './commit-subject';
import { GraphTile } from './graph-tile';
import type { Commit } from '../../shared/model';

export interface CommitRowModel {
  commit: Commit;
  contentKey: string;
  graphKey: unknown;
  graphWidth: number;
  selected: boolean;
  highlight: boolean;
  mergeMuted: boolean;
  headHighlight: boolean;
  cherryMuted: boolean;
  isMe: boolean;
  index: number;
  total: number;
  decorations: string;
  referenceGroups?: ReferenceGroup[];
  refsLeft: boolean;
  compactRefs: boolean;
  columns: string[];
  values: Record<string, string>;
  titles: Record<string, string>;
  graph(): HTMLElement;
}
export interface CommitListProps {
  rows: CommitRowModel[];
  emptyText?: string;
  hostSubjectHover?: boolean;
  spacerTop?: number;
  spacerBottom?: number;
  rowId?(commit: Commit): string;
  select(commit: Commit, event: MouseEvent): void;
  context(commit: Commit, event: MouseEvent): void;
  onKeyDown(commit: Commit, event: KeyboardEvent, row: HTMLElement): void;
  drag(cell: HTMLElement, column: string): void;
  resize(grip: HTMLElement, column: string): void;
}

function Column({
  model,
  column,
  host,
}: {
  model: CommitRowModel;
  column: string;
  host: CommitListProps;
}) {
  const cell = useRef<HTMLSpanElement>(null);
  const grip = useRef<HTMLSpanElement>(null);
  const { drag, resize } = host;
  useLayoutEffect(() => {
    if (!cell.current || !grip.current) return;
    drag(cell.current, column);
    resize(grip.current, column);
  }, [column, drag, resize]);
  const subject = column === 'subject';
  const refs = (
    <ReferenceLabels
      groups={model.referenceGroups ?? referenceGroups(model.decorations, [], model.compactRefs)}
      compact={model.compactRefs}
      subject={model.commit.subject}
      graphWidth={model.graphWidth}
      left={model.refsLeft}
    />
  );
  useLayoutEffect(() => {
    if (subject) cell.current?.style.setProperty('--graph-width', `${model.graphWidth}px`);
  }, [subject, model.graphWidth]);
  return (
    <span
      ref={cell}
      className={
        subject
          ? 'subject log-column' + (model.refsLeft ? ' refs-left' : '')
          : 'log-column ' + column + (column === 'author' && model.isMe ? ' my-author' : '')
      }
      title={subject ? undefined : model.titles[column]}
    >
      {subject ? (
        <span className="subject-content">
          <GraphTile graphKey={model.graphKey} graph={model.graph} />
          {model.refsLeft && refs}
          <CommitSubject text={model.commit.subject ?? ''} hostHover={host.hostSubjectHover} />
          {!model.refsLeft && refs}
        </span>
      ) : (
        <span className="column-text">{model.values[column]}</span>
      )}
      <span
        ref={grip}
        className="column-resizer"
        role="separator"
        tabIndex={0}
        aria-label={subject ? 'Resize graph and message column' : `Resize ${column} column`}
      />
    </span>
  );
}
const CommitRow = memo(
  function CommitRow({ model, host }: { model: CommitRowModel; host: CommitListProps }) {
    const row = useRef<HTMLDivElement>(null);
    const classes = [
      'commit',
      model.selected && 'selected',
      model.highlight && 'highlighted',
      model.mergeMuted && 'merge-muted',
      model.headHighlight && 'head-highlight',
      model.cherryMuted && 'cherry-muted',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div
        ref={row}
        className={classes}
        tabIndex={0}
        id={host.rowId?.(model.commit)}
        data-hash={model.commit.hash}
        role="option"
        aria-posinset={model.index + 1}
        aria-setsize={model.total}
        aria-selected={model.selected}
        aria-label={`${model.commit.hash} ${model.commit.subject}`}
        onClick={(event) => host.select(model.commit, event.nativeEvent)}
        onContextMenu={(event) => {
          event.preventDefault();
          host.context(model.commit, event.nativeEvent);
        }}
        onKeyDown={(event) => host.onKeyDown(model.commit, event.nativeEvent, event.currentTarget)}
      >
        {model.columns.map((column) => (
          <Column key={column} model={model} column={column} host={host} />
        ))}
      </div>
    );
  },
  (a, b) =>
    a.host.hostSubjectHover === b.host.hostSubjectHover &&
    a.host.select === b.host.select &&
    a.host.context === b.host.context &&
    a.host.onKeyDown === b.host.onKeyDown &&
    a.host.drag === b.host.drag &&
    a.host.resize === b.host.resize &&
    a.model.contentKey === b.model.contentKey &&
    a.model.graphKey === b.model.graphKey &&
    a.model.selected === b.model.selected &&
    a.model.index === b.model.index &&
    a.model.total === b.model.total &&
    a.model.decorations === b.model.decorations &&
    a.model.graphWidth === b.model.graphWidth &&
    a.model.highlight === b.model.highlight &&
    a.model.mergeMuted === b.model.mergeMuted &&
    a.model.headHighlight === b.model.headHighlight &&
    a.model.cherryMuted === b.model.cherryMuted &&
    a.model.isMe === b.model.isMe &&
    a.model.refsLeft === b.model.refsLeft &&
    a.model.compactRefs === b.model.compactRefs &&
    a.model.columns.join('|') === b.model.columns.join('|'),
);
export function CommitList(props: CommitListProps) {
  return (
    <>
      <div
        className="commit-spacer commit-spacer-top"
        style={props.spacerTop === undefined ? undefined : { height: props.spacerTop }}
        aria-hidden="true"
      />
      {props.rows.map((model) => (
        <CommitRow key={model.commit.hash} model={model} host={props} />
      ))}
      <div
        className="commit-spacer commit-spacer-bottom"
        style={props.spacerBottom === undefined ? undefined : { height: props.spacerBottom }}
        aria-hidden="true"
      />
      {props.emptyText && <p className="empty">{props.emptyText}</p>}
    </>
  );
}
