import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MergeDiff } from './react/merge-diff';
import './api';
import { setupSyntaxChannel } from './merge/syntax-channel';
import type { MergePaneWidths } from './merge/pane-widths';
const api = acquireVsCodeApi();
setupSyntaxChannel(api);
const root = createRoot(document.getElementById('merge-app')!);
const savePaneWidths = (widths: MergePaneWidths) =>
  api.setState({ ...api.getState(), mergePaneWidths: widths });
window.addEventListener('message', ({ data }) => {
  if (data.type === 'mergeDiff')
    root.render(
      createElement(MergeDiff, {
        data: data.data,
        send: (message) => api.postMessage(message),
        initialPaneWidths: api.getState()?.mergePaneWidths,
        onPaneWidthsChange: savePaneWidths,
      }),
    );
});
window.addEventListener('unload', () => root.unmount());
api.postMessage({ type: 'ready' });
