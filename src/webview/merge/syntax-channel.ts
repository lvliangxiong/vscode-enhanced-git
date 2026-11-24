import type { WebviewApi } from '../api';

let send: WebviewApi['postMessage'] | undefined;
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: any) => void; timer: ReturnType<typeof setTimeout> }
>();
const listeners = new Set<() => void>();

export function setupSyntaxChannel(api: WebviewApi) {
  send = (message) => api.postMessage(message);
  const receive = ({ data }: MessageEvent) => {
    if (data.type === 'mergeSyntaxChanged') for (const listener of listeners) listener();
    if (data.type !== 'mergeSyntax') return;
    const item = pending.get(data.request);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(data.request);
    item.resolve(data.value);
  };
  window.addEventListener('message', receive);
  window.addEventListener(
    'unload',
    () => {
      send = undefined;
      window.removeEventListener('message', receive);
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.resolve(null);
      }
      pending.clear();
      listeners.clear();
    },
    { once: true },
  );
}
export function requestSyntax<T>(
  action: string,
  fields: Record<string, unknown> = {},
): Promise<T | null> {
  const post = send;
  if (!post) return Promise.resolve(null);
  const request = ++sequence;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(request);
      resolve(null);
    }, 10000);
    pending.set(request, { resolve, timer });
    post({ type: 'mergeSyntax', action, request, ...fields });
  });
}
export function onSyntaxChanged(listener: () => void) {
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}
