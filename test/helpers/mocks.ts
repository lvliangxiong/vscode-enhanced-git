/**
 * Minimal DOM doubles used by VM-based webview tests. Production code attaches
 * handlers and properties at runtime; these doubles intentionally implement only
 * the surface exercised by each test, rather than claiming to be real DOM nodes.
 */
export interface MockNode {
  [property: string]: any;
  children?: MockNode[];
  dataset?: Record<string, string>;
  events?: Record<string, (...args: any[]) => void>;
}

export interface MockPointerEvent {
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  stopped?: boolean;
  prevented?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
