import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './api';
import { FileHistory } from './react/file-history';
const api = acquireVsCodeApi();
const root = createRoot(document.getElementById('file-history-app')!);
root.render(createElement(FileHistory, { api }));
window.addEventListener('unload', () => root.unmount());
