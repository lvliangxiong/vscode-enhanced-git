import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import type { LogContext } from '../log/context';

export interface BranchSummaryProps {
  message?: string;
  names?: string[] | null;
  document: Document;
  window: Window;
  sheet: CSSStyleSheet;
  closeVersion?: number;
}
/** Shared footer presentation for standalone logs and the multi-repository host. */
export function BranchSummary({
  message = '',
  names = null,
  document,
  window,
  sheet,
  closeVersion,
}: BranchSummaryProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLElement>(null);
  const positionStyle = useRef<CSSStyleDeclaration>(null);
  const signature = JSON.stringify([message, names, closeVersion]);
  useEffect(() => {
    setOpen(false);
  }, [signature]);
  useLayoutEffect(() => {
    if (!open || !popup.current) return;
    positionStyle.current ??= (
      sheet.cssRules[
        sheet.insertRule('#selected-branches-popup {}', sheet.cssRules.length)
      ] as CSSStyleRule
    ).style;
    positionStyle.current.left = `${Math.max(8, Math.min(button.current!.getBoundingClientRect().left, window.innerWidth - popup.current.offsetWidth - 8))}px`;
    popup.current.focus();
  }, [open, sheet, window]);
  useEffect(() => {
    const close = (event: Event) => {
      if (
        !button.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    window.addEventListener('vsCodeGitHidden', resize);
    window.addEventListener('blur', resize);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
      window.removeEventListener('vsCodeGitHidden', resize);
      window.removeEventListener('blur', resize);
    };
  }, [document, window, open]);
  return (
    <>
      <span>
        {names === null ? (
          message
        ) : (
          <>
            {names.length > 1 ? (
              <button
                ref={button}
                className="branch-summary-label"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls="selected-branches-popup"
                onClick={() => setOpen(!open)}
              >
                Selected Branches
              </button>
            ) : (
              <span className="branch-summary-label" title={names[0]}>
                {names[0] || 'All Branches'}
              </span>
            )}
            <span className="branch-summary-hint">
              {' '}
              · Cmd/Ctrl-click: multi-select · Shift-click: range
            </span>
          </>
        )}
      </span>
      {createPortal(
        <section
          ref={popup}
          id="selected-branches-popup"
          hidden={!open}
          tabIndex={-1}
          role="dialog"
          aria-label="Selected Branches"
        >
          <ul>
            {names?.map((name, index) => (
              <li key={`${index}:${name}`}>{name}</li>
            ))}
          </ul>
        </section>,
        document.body,
      )}
    </>
  );
}
export function LogBranchSummary({ ctx }: { ctx: LogContext }) {
  const status = useStore(ctx.store, (s) => s.status);
  return (
    <BranchSummary
      message={typeof status === 'string' ? status : ''}
      names={Array.isArray(status) ? status : null}
      document={ctx.env.document}
      window={ctx.env.window}
      sheet={ctx.env.layoutSheet}
    />
  );
}
