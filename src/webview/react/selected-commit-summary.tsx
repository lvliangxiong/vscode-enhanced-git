import type { SelectedCommitChanges } from '../../shared/model';

/** Compact context for the file list; the explanation stays outside its scroll area. */
export function SelectedCommitSummary({ commits }: Pick<SelectedCommitChanges, 'commits'>) {
  return (
    <div className="selected-commit-section">
      <details className="selected-commit-summary">
        <summary aria-label={`${commits.length} selected commit${commits.length === 1 ? '' : 's'}`}>
          <span className="rebased-icon rebased-right" aria-hidden="true" />
          <span className="selected-commit-label">Selected commits</span>
          <span className="selected-commit-count" aria-hidden="true">
            {commits.length}
          </span>
        </summary>
        <ol aria-label="Selected commits">
          {commits.map((commit) => (
            <li key={commit.hash} title={`${commit.hash}\n${commit.subject || ''}`}>
              <span className="selected-commit-hash">{commit.hash.slice(0, 8)}</span>
              <span className="selected-commit-subject">{commit.subject || commit.hash}</span>
            </li>
          ))}
        </ol>
      </details>
      <span
        className="selected-commit-info"
        tabIndex={0}
        role="img"
        aria-label="About these changes"
        aria-describedby="selected-commit-help"
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" />
          <path d="M8 7v4" fill="none" stroke="currentColor" />
          <circle cx="8" cy="4.5" r="0.75" fill="currentColor" />
        </svg>
        <span id="selected-commit-help" className="selected-commit-help" role="tooltip">
          Files aggregate the selected commits. Each diff compares the file’s before/after
          revisions, so intervening edits to the same file may appear.
        </span>
      </span>
    </div>
  );
}
