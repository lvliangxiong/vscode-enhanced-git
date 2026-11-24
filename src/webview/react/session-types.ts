import type { ReactNode } from 'react';
import type { LogContext } from '../log/context';
export interface ActionMenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  icon?: string;
  shortcut?: string;
  title?: string;
  separator?: boolean;
  heading?: string;
  checked?: boolean;
  role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  children?: ActionMenuItem[];
  /** Checkbox menus can remain open while their state changes. */
  keepOpen?: boolean;
}
export interface MenuModel {
  items: ActionMenuItem[];
  point?: { x: number; y: number };
  anchor?: HTMLElement;
  heading?: string;
  label?: string;
  variant?: 'context' | 'view';
}
export interface HoverModel {
  kind: 'refs' | 'message' | 'jump' | 'toolbar';
  text?: string;
  names?: string[];
  references?: import('../../shared/reference-labels').ReferenceLabel[];
  copy?: (name: string) => void;
  onMount?: (element: HTMLElement) => void;
}
export interface ChromeButton {
  label?: string;
  icon?: string;
  disabled?: boolean;
  hidden?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  active?: boolean;
  modified?: boolean;
  outdated?: boolean;
  onClick?: () => void;
}
export interface ChromeState {
  buttons: Record<string, ChromeButton>;
  overflow: { collapsed: boolean; expanded: boolean; visibleCount: number; focusFirst: boolean };
}
export type SessionSlots = Partial<
  Record<'branches' | 'commits' | 'files' | 'message' | 'preview' | 'filter' | 'status', ReactNode>
>;
export interface RefDialogModel {
  id: string;
  kind: 'branch' | 'tag';
  hash: string;
  busy?: boolean;
  onSubmit(value: { name: string; checkout: boolean; dialogId: string }): void;
  onClose?(): void;
}
export interface UiSnapshot {
  slots: SessionSlots;
  session: LogContext | null;
  chrome: ChromeState;
  menus: Record<string, MenuModel | null>;
  hovers: Record<string, HoverModel | null>;
  refDialog: RefDialogModel | null;
}
export interface SessionUi {
  bindSession(session: LogContext): void;
  setSlots(slots: SessionSlots): void;
  patchChrome(patch: Partial<ChromeState>): void;
  openContextMenu(model: MenuModel): void;
  closeContextMenu(): void;
  openMenu(id: string, model: MenuModel): void;
  isMenuOpen(id: string, anchor?: HTMLElement): boolean;
  closeMenu(id: string, restore?: boolean): void;
  openRefDialog(model: Omit<RefDialogModel, 'id'>): string;
  finishRefDialog(id: string, error?: boolean | string): void;
  showHover(id: string, model: HoverModel): void;
  hideHover(id: string): void;
  dispose(): void;
}
export interface SessionUiEnvironment {
  container: HTMLElement;
  document: Document;
  window: Window;
  sheet: CSSStyleSheet;
  comparison?: { start: { name: string }; end: { name: string } };
}
