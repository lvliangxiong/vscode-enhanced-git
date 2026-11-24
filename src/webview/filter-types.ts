import type { Author, Branch, RecentGroups, RecentKind } from '../shared/model';

export type FilterKind = RecentKind | 'date';
export interface FilterPeriod {
  since: string;
  until: string;
  sinceHours: number;
}
export interface FilterPath {
  path: string;
  name: string;
  directory: boolean;
}
export interface FilterModel extends FilterPeriod {
  root: string;
  refs: string[];
  branches: Branch[];
  favorites: ReadonlySet<string>;
  authors: string[];
  paths: string[];
  user?: string;
  authorOptions: Author[];
  recents: RecentGroups;
}
/** The tuple keeps each filter kind paired with its value shape at the host boundary. */
export type FilterApplyArgs =
  | [kind: RecentKind, values: string[], remember: boolean]
  | [kind: 'date', values: FilterPeriod, remember: boolean];

export interface FilterHost {
  popup: HTMLElement;
  sheet: CSSStyleSheet;
  document?: Document;
  window?: Window;
  model(): FilterModel;
  beforeOpen(): void;
  apply(...args: FilterApplyArgs): void;
  favorite(ref: string): void;
  removeRecent(kind: RecentKind, values: string[]): void;
  clearRecent(kind: RecentKind): void;
  pathChildren(path: string): Promise<FilterPath[]>;
  themeFileIcon: { set(node: HTMLElement, path: string): void };
  subscribe?(listener: () => void): () => void;
}

export function isFilterKind(value: string): value is FilterKind {
  return ['branch', 'user', 'date', 'paths'].includes(value);
}
export function isFilterPath(value: unknown): value is FilterPath {
  return (
    value !== null &&
    typeof value === 'object' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'directory' in value &&
    typeof value.directory === 'boolean'
  );
}
