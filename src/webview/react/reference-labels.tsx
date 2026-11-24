import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  layoutReferenceGroups,
  referenceIconWidth,
  referenceIconStep,
  referenceIconGap,
  referenceWidthBudget,
} from '../../shared/reference-layout';
import type { ReferenceLabel, ReferenceGroup } from '../../shared/reference-labels';

// Rebased TagPainter outline (Apache-2.0); SVG masks preserve occlusion on translucent surfaces.
const tagOutline =
  'M13.4495 7.5001L7.01028 13.9394C6.81502 14.1347 6.49843 14.1347 6.30317 13.9394L2.06053 9.69679C1.86527 9.50152 1.86527 9.18494 2.06053 8.98968L8.49978 2.55035C8.61106 2.43907 8.76824 2.38667 8.92404 2.40893L12.6363 2.93926C12.8563 2.97069 13.0292 3.14354 13.0606 3.36352L13.5909 7.07584C13.6132 7.23163 13.5608 7.38882 13.4495 7.5001Z';

export function ReferenceIcon({ refs }: { refs: ReferenceLabel[] }) {
  const maskId = useId().replace(/:/g, '');
  const types = [...new Set(refs.map((ref) => ref.kind))]
    .flatMap((kind) =>
      refs
        .filter((ref) => ref.kind === kind)
        .slice(0, 2)
        .map(() => kind),
    )
    .reverse();
  return (
    <svg
      className="reference-icon"
      width={referenceIconWidth(refs)}
      height="16"
      viewBox={`0 0 ${referenceIconWidth(refs)} 16`}
      aria-hidden="true"
    >
      <defs>
        {types.slice(0, -1).map((_, index) => (
          <mask
            key={index}
            id={`${maskId}-${index}`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={referenceIconWidth(refs)}
            height="16"
          >
            <rect width={referenceIconWidth(refs)} height="16" fill="white" />
            {types.slice(index + 1).flatMap((_, offset) =>
              // Rebased also paints a background-colored tag just before the
              // next tag, leaving a visible separation between their outlines.
              [0, referenceIconGap].map((gap) => (
                <path
                  key={`${offset}-${gap}`}
                  transform={`translate(${(index + offset + 1) * referenceIconStep - gap} 0)`}
                  d={tagOutline}
                  fill="black"
                  stroke="black"
                  strokeWidth="1"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )),
            )}
          </mask>
        ))}
      </defs>
      {types.map((kind, index) => (
        <g key={index} mask={index < types.length - 1 ? `url(#${maskId}-${index})` : undefined}>
          <g
            transform={`translate(${index * referenceIconStep} 0)`}
            className={`reference-${kind}`}
          >
            <path className="reference-icon-body" d={tagOutline} />
            {index === types.length - 1 && <circle cx="10.5" cy="5.5" r="1" fill="currentColor" />}
          </g>
        </g>
      ))}
    </svg>
  );
}
export function ReferenceLabels({
  groups,
  compact,
  subject = '',
  graphWidth = 0,
  left = false,
}: {
  groups: ReferenceGroup[];
  compact: boolean;
  subject?: string;
  graphWidth?: number;
  left?: boolean;
}) {
  const element = useRef<HTMLElement>(null);
  const [display, setDisplay] = useState(groups);
  useLayoutEffect(() => {
    const node = element.current;
    const host = node?.closest<HTMLElement>('.subject-content');
    if (!node || !host) {
      setDisplay(groups);
      return;
    }
    const document = node.ownerDocument;
    const window = document.defaultView;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!window || !context) {
      setDisplay(groups);
      return;
    }
    let active = true;
    const measure = () => {
      if (!active) return;
      const title = host.querySelector<HTMLElement>('.subject-text');
      context.font = window.getComputedStyle(title || node).font;
      const subjectWidth = context.measureText(subject).width;
      context.font = window.getComputedStyle(node).font;
      const gap = parseFloat(window.getComputedStyle(host).columnGap) || 0;
      const width = referenceWidthBudget(
        host.clientWidth - graphWidth - gap * 2,
        subjectWidth,
        compact,
        left,
      );
      const next = layoutReferenceGroups(
        groups,
        width,
        compact,
        (text) => context.measureText(text).width,
      );
      setDisplay((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    measure();
    const resize = new window.ResizeObserver(measure);
    resize.observe(host);
    const theme = new window.MutationObserver(measure);
    theme.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    document.fonts?.ready.then(measure);
    return () => {
      active = false;
      resize.disconnect();
      theme.disconnect();
    };
  }, [groups, compact, subject, graphWidth, left]);
  const refs = groups.flatMap((group) => group.refs);
  if (!refs.length) return null;
  return (
    <small
      ref={element}
      className={'refs reference-labels' + (compact ? '' : ' expanded-refs')}
      data-references={JSON.stringify(refs.map((ref) => ref.name))}
      data-reference-labels={JSON.stringify(refs)}
      aria-label={refs.map((ref) => ref.name).join('\n')}
      tabIndex={0}
    >
      {display.map((group, index) => (
        <span className="reference-group" key={index}>
          <ReferenceIcon refs={group.refs} />
          {group.name && <span className="reference-name">{group.name}</span>}
        </span>
      ))}
    </small>
  );
}
