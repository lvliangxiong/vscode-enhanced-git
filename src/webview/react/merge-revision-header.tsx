import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { MergeCommit, MergeCommitStats } from '../../shared/merge-diff';
import { commitRelativeTime } from './commit-details';

function absoluteTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      });
}

/** Header-only state keeps hovering from recreating any Monaco models. */
export function MergeRevisionHeader({
  label,
  commit,
  onAction,
}: {
  label: string;
  commit?: MergeCommit;
  onAction?: (action: 'copy' | 'email' | 'stats') => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<MergeCommitStats | null>();
  const requested = useRef(false);
  useEffect(() => {
    requested.current = false;
    setStats(undefined);
    const receive = ({ data }: MessageEvent) => {
      if (data?.type !== 'mergeCommitStats' || data.hash !== commit?.hash) return;
      setStats(data.stats);
      if (!data.stats) requested.current = false;
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [commit?.hash]);
  useEffect(() => {
    if (!open || stats !== undefined || requested.current || !onAction) return;
    requested.current = true;
    onAction('stats');
  }, [open, stats, commit?.hash, onAction]);
  const close = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  const enter = () => {
    clearTimeout(timer.current);
    if (stats === null) setStats(undefined);
    timer.current = setTimeout(() => setOpen(true), 200);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !popup.current) return;
    const rect = anchor.current.getBoundingClientRect(),
      element = popup.current;
    element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - element.offsetHeight - 8))}px`;
  }, [open, stats]);
  if (!commit) return <header>{label}</header>;
  const paragraphs = commit.message
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const differentCommitter =
    commit.committer !== commit.author ||
    commit.committerEmail !== commit.email ||
    commit.date !== commit.authorDate;
  return (
    <header
      ref={anchor}
      className="merge-revision-header"
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      onPointerEnter={enter}
      onPointerLeave={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(close, 120);
      }}
      onFocus={enter}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}
    >
      <span className="merge-revision-summary">
        <span className="merge-revision-label">{label}</span>
        <span className="merge-revision-person">{commit.author}</span>
        <time dateTime={commit.authorDate}>{commitRelativeTime(commit.authorDate)}</time>
      </span>
      {open && (
        <div
          className="merge-commit-hover"
          id={id}
          ref={popup}
          role="tooltip"
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={() => {
            timer.current = setTimeout(close, 120);
          }}
        >
          <div className="merge-commit-content">
            <div className="merge-commit-person">
              <span className="codicon codicon-account" aria-hidden="true" />
              <a
                href={'mailto:' + commit.email}
                title={commit.email}
                onClick={(event) => {
                  event.preventDefault();
                  onAction?.('email');
                }}
              >
                <strong>{commit.author}</strong>
              </a>
              <span className="merge-commit-comma">,</span>
              <span className="codicon codicon-history" aria-hidden="true" />
              <span className="merge-commit-date">
                {commitRelativeTime(commit.authorDate)} ({absoluteTime(commit.authorDate)})
              </span>
            </div>
            {differentCommitter && (
              <div className="merge-commit-committer">
                Committed by {commit.committer} &lt;{commit.committerEmail}&gt; ·{' '}
                {absoluteTime(commit.date)}
              </div>
            )}
            <div className="merge-commit-body">
              {paragraphs.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          </div>
          {stats && (
            <div className="merge-commit-stats">
              <span>
                {stats.files} {stats.files === 1 ? 'file' : 'files'} changed
              </span>
              {stats.insertions > 0 && (
                <>
                  ,{' '}
                  <span className="merge-commit-insertions">
                    {stats.insertions} {stats.insertions === 1 ? 'insertion' : 'insertions'}(+)
                  </span>
                </>
              )}
              {stats.deletions > 0 && (
                <>
                  ,{' '}
                  <span className="merge-commit-deletions">
                    {stats.deletions} {stats.deletions === 1 ? 'deletion' : 'deletions'}(-)
                  </span>
                </>
              )}
            </div>
          )}
          <div className="merge-commit-footer">
            <span className="merge-commit-hash" title={commit.hash}>
              <span className="codicon codicon-git-commit" aria-hidden="true" />
              <code>{commit.hash.slice(0, 8)}</code>
            </span>
            <button
              type="button"
              className="merge-commit-copy"
              title="Copy Commit Hash"
              aria-label="Copy Commit Hash"
              onClick={() => onAction?.('copy')}
            >
              <span className="codicon codicon-copy" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
