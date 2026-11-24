import { useEffect, useRef, useState } from 'react';
import type { MergeDiffData } from '../../shared/merge-diff';
import { mergeDiffStyle } from '../../shared/merge-diff';
import type { MergeEditors, MountMergeEditors } from '../merge/types';
import { MergeRevisionHeader } from './merge-revision-header';
import { MergePanes } from './merge-panes';
import { mergeSashWidth, type MergePaneWidths } from '../merge/pane-widths';

const loadEditors: MountMergeEditors = async (containers, data) =>
  (await import('../merge/runtime')).mountMergeEditors(containers, data);
/** React owns the shell; Monaco owns source models, selection and visible lines. */
export function MergeDiff({
  data,
  send,
  mountEditors = loadEditors,
  initialPaneWidths,
  onPaneWidthsChange,
}: {
  data: MergeDiffData;
  send: (message: { type: string; [key: string]: unknown }) => void;
  mountEditors?: MountMergeEditors;
  initialPaneWidths?: unknown;
  onPaneWidthsChange?: (widths: MergePaneWidths) => void;
}) {
  const binary = data.contents.some((text) => text.includes('\0'));
  const containers = useRef<(HTMLDivElement | null)[]>([]);
  const editors = useRef<MergeEditors>(null);
  const [status, setStatus] = useState('Loading editors…');
  const [style, setStyle] = useState(() => mergeDiffStyle(data.style));
  const selectedStyle = useRef(style);
  useEffect(() => {
    const action = ({ data: message }: MessageEvent) => {
      if (message?.type === 'mergeDiffStyle') {
        selectedStyle.current = mergeDiffStyle(message.style);
        setStyle(selectedStyle.current);
        editors.current?.setStyle?.(selectedStyle.current);
        return;
      }
      if (message?.type !== 'mergeAction') return;
      if (message.action === 'previous') editors.current?.navigate(-1);
      if (message.action === 'next') editors.current?.navigate(1);
    };
    window.addEventListener('message', action);
    return () => window.removeEventListener('message', action);
  }, []);
  useEffect(() => {
    send({ type: 'mergeEditorState', ready: false });
    selectedStyle.current = mergeDiffStyle(data.style);
    setStyle(selectedStyle.current);
    const panes = containers.current;
    if (binary || !panes.every((pane) => pane !== null)) return;
    let canceled = false;
    let instance: MergeEditors;
    setStatus('Loading editors…');
    void mountEditors(panes, data)
      .then((value) => {
        instance = value;
        if (canceled) value.dispose();
        else {
          editors.current = value;
          value.setStyle?.(selectedStyle.current);
          setStatus('');
          send({
            type: 'mergeEditorState',
            ready: data.patches.some((patch) => /\n?@@ /.test(patch)),
          });
        }
      })
      .catch(() => {
        if (!canceled)
          setStatus('Unable to load editors. Use a parent comparison to inspect the file.');
      });
    return () => {
      canceled = true;
      editors.current = null;
      instance?.dispose();
      send({ type: 'mergeEditorState', ready: false });
    };
  }, [data, binary, mountEditors, send]);
  return (
    <main className="merge-diff">
      {binary ? (
        <p className="merge-status">Binary content. Use a parent comparison to inspect the file.</p>
      ) : (
        <>
          {status && (
            <p className="merge-status" role="status">
              {status}
            </p>
          )}
          <MergePanes
            initialWidths={initialPaneWidths}
            onWidthsChange={onPaneWidthsChange}
            sashWidth={style === 'native' ? 1 : mergeSashWidth}
          >
            {data.labels.map((label, side) => (
              <section key={side} aria-label={label}>
                <MergeRevisionHeader
                  label={label}
                  commit={data.commits?.[side]}
                  onAction={(action) =>
                    send({ type: 'mergeCommitAction', action, hash: data.commits?.[side]?.hash })
                  }
                />
                <div
                  className="merge-editor"
                  ref={(node) => {
                    containers.current[side] = node;
                  }}
                />
              </section>
            ))}
          </MergePanes>
        </>
      )}
    </main>
  );
}
