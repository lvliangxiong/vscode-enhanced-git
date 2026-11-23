import type { MergeDiffData, MergeDiffStyle } from '../../shared/merge-diff';

export interface MergeEditors {
  navigate(direction: -1 | 1): void;
  dispose(): void;
  setStyle?(style: MergeDiffStyle): void;
}
export type MountMergeEditors = (
  containers: HTMLElement[],
  data: MergeDiffData,
) => Promise<MergeEditors>;
