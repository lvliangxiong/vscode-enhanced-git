/** Host messaging and persisted state supplied by VS Code to each webview. */
export interface WebviewApi {
  postMessage(message: { type: string; [key: string]: unknown }): void;
  getState(): Record<string, any> | undefined;
  setState<T>(state: T): T;
}

declare global {
  /** Injected into the webview document, rather than exposed on window. */
  function acquireVsCodeApi(): WebviewApi;
}
