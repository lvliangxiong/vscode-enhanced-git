import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Clipped titles use the same hover in every CommitList, independent of its host. */
export function CommitSubject({ text, hostHover = false }: { text: string; hostHover?: boolean }) {
  const popup = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const hide = () => {
    clearTimeout(timer.current);
    setPosition(undefined);
  };
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const element = target.current;
      if (!element?.isConnected || element.scrollWidth <= element.clientWidth) return;
      const rect = element.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(rect.left - 5, window.innerWidth - 80)),
        top: Math.max(8, Math.min(rect.top - 3, window.innerHeight - 48)),
      });
    }, 150);
  };
  useLayoutEffect(() => {
    const element = popup.current;
    if (!position || !element || !target.current) return;
    const font = window.getComputedStyle(target.current);
    element.style.font = font.font;
    element.style.color = font.color;
    element.style.maxWidth = `${Math.max(0, window.innerWidth - 16)}px`;
    element.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
    const rect = target.current.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(rect.left - 5, window.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(rect.top - 3, window.innerHeight - element.offsetHeight - 8))}px`;
  }, [position]);
  useEffect(() => {
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [text]);
  return (
    <>
      <span
        ref={target}
        className="subject-text"
        data-shared-hover={hostHover ? undefined : 'true'}
        onPointerEnter={hostHover ? undefined : show}
        onPointerLeave={hostHover ? undefined : hide}
        onFocus={hostHover ? undefined : show}
        onBlur={hostHover ? undefined : hide}
        aria-describedby={position ? 'commit-subject-tooltip' : undefined}
      >
        {text}
      </span>
      {position &&
        createPortal(
          <div
            ref={popup}
            id="commit-subject-tooltip"
            role="tooltip"
            className="commit-hover message-hover commit-subject-tooltip"
            style={{
              left: position.left,
              top: position.top,
              maxWidth: window.innerWidth - position.left - 8,
            }}
          >
            <span className="hover-message">{text}</span>
          </div>,
          document.body,
        )}
    </>
  );
}
