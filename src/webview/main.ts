import { mountLog } from './log/session';

mountLog({
  document,
  window,
  scope: globalThis as import('./log/context').BrowserScope,
  api: acquireVsCodeApi(),
});
