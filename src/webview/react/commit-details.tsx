import { comparisonLabels } from '../../shared/comparison-labels';
import type { ReactNode } from 'react';
import type { Commit } from '../../shared/model';

export interface CommitStats {
  files: number;
  insertions: number;
  deletions: number;
  binary?: number;
}
export interface CommitDetail {
  commit: Commit;
  message: string;
  stats?: CommitStats;
}
export interface CommitDetailsProps {
  items: readonly CommitDetail[];
  onOpenLink: (url: string) => void;
  onShowChanges: (hash: string) => void;
  onCopy: (hash: string) => void;
}

export function commitRelativeTime(value: string | Date, now = Date.now()): string {
  const seconds = (new Date(value).getTime() - now) / 1000;
  if (!Number.isFinite(seconds)) return '';
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as [Intl.RelativeTimeFormatUnit, number][]) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
}

/** Commit messages remain literal text; only web URLs and email addresses become links. */
export function CommitText({
  text,
  onOpenLink,
}: { text: string } & Pick<CommitDetailsProps, 'onOpenLink'>) {
  const content: ReactNode[] = [];
  const pattern = /https?:\/\/[^\s<>]+|[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    content.push(text.slice(offset, match.index));
    const label = match[0].replace(/[.,;!?)]+$/, '');
    const url = /^https?:/.test(label) ? label : 'mailto:' + label;
    content.push(
      <a
        key={match.index}
        href={url}
        onClick={(event) => {
          event.preventDefault();
          onOpenLink(url);
        }}
      >
        {label}
      </a>,
      match[0].slice(label.length),
    );
    offset = match.index! + match[0].length;
  }
  content.push(text.slice(offset));
  return <>{content}</>;
}

function Person({
  name,
  email,
  coauthor = false,
  onOpenLink,
}: {
  name?: string;
  email?: string;
  coauthor?: boolean;
} & Pick<CommitDetailsProps, 'onOpenLink'>) {
  return (
    <div className="commit-person">
      <span className="commit-person-icon" />
      <a
        className="commit-author"
        href={'mailto:' + email}
        title={email}
        onClick={(event) => {
          event.preventDefault();
          onOpenLink('mailto:' + email);
        }}
      >
        {name}
      </a>
      {coauthor && <em>(Co-author)</em>}
    </div>
  );
}

export function CommitStatistics({ value }: { value: CommitStats }) {
  return (
    <div className="commit-stats">
      <span>{value.files} files changed, </span>
      <span className="commit-insertions">{value.insertions} insertions(+)</span>
      <span>, </span>
      <span className="commit-deletions">{value.deletions} deletions(-)</span>
      {Boolean(value.binary) && <span>, {value.binary} binary files</span>}
    </div>
  );
}

function CommitArticle({
  item,
  onOpenLink,
  onShowChanges,
  onCopy,
}: {
  item: CommitDetail;
} & Omit<CommitDetailsProps, 'items'>) {
  const { commit, message, stats } = item;
  const date = new Date(commit.authorDate || commit.date || '');
  const coauthors = new Map<string, { name: string; email: string }>();
  for (const match of message.matchAll(/^Co-authored-by:\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/gim)) {
    const key = match[2].toLowerCase();
    if (!coauthors.has(key)) coauthors.set(key, { name: match[1], email: match[2] });
  }
  const [title, ...body] = message.split('\n');
  const text = body.join('\n').trim();
  return (
    <article className="commit-details" data-hash={commit.hash}>
      <Person name={commit.author} email={commit.email} onOpenLink={onOpenLink} />
      <div className="commit-time">
        <span className="commit-clock-icon" />
        <span>
          {Number.isNaN(date.getTime())
            ? ''
            : `${commitRelativeTime(date)} (${date.toLocaleString()})`}
        </span>
      </div>
      {[...coauthors].map(([key, person]) => (
        <Person key={key} {...person} coauthor onOpenLink={onOpenLink} />
      ))}
      <h3 className="commit-title">
        <CommitText text={title} onOpenLink={onOpenLink} />
      </h3>
      {text && (
        <div className="commit-body">
          <CommitText text={text} onOpenLink={onOpenLink} />
        </div>
      )}
      {stats && <CommitStatistics value={stats} />}
      <div className="commit-footer">
        <a
          className="commit-revision"
          href="#"
          title={`${comparisonLabels.files} — ${commit.hash}`}
          aria-label={`${comparisonLabels.files} for commit ${commit.hash.slice(0, 8)}`}
          onClick={(event) => {
            event.preventDefault();
            onShowChanges(commit.hash);
          }}
        >
          <code>{commit.hash.slice(0, 8)}</code>
        </a>
        <button
          className="commit-copy"
          title="Copy Revision Number"
          aria-label="Copy Revision Number"
          onClick={() => onCopy(commit.hash)}
        >
          <span className="copy-action-icon" />
        </button>
      </div>
    </article>
  );
}

export function CommitDetails({ items, ...actions }: CommitDetailsProps) {
  return (
    <>
      {items.map((item) => (
        <CommitArticle key={item.commit.hash} item={item} {...actions} />
      ))}
    </>
  );
}
