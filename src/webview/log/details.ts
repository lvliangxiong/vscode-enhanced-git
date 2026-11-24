import type { LogContext } from './context';
import type { CommitDetail, CommitStats } from '../react/commit-details';

export interface DetailsController {
  start(): void;
  dispose(): void;
  showCommitDetails(items: CommitDetail[]): void;
  updateCommitDetailStats(items: { hash: string; stats: CommitStats }[]): void;
  openLink(url: string): void;
  showChanges(hash: string): void;
  copy(hash: string): void;
}

export function createDetailsController(ctx: LogContext): DetailsController {
  return {
    start() {},
    dispose() {},
    showCommitDetails(items) {
      ctx.actions.files.store.setState({ items });
    },
    updateCommitDetailStats(items) {
      const stats = new Map(items.map((item) => [item.hash, item.stats]));
      const store = ctx.actions.files.store;
      store.setState({
        items: store.getState().items.map((item) => ({
          ...item,
          stats: stats.get(item.commit.hash) || item.stats,
        })),
      });
    },
    openLink: (url) => ctx.env.send('openCommitLink', { url }),
    showChanges: (hash) => ctx.env.send('commitChanges', { hash }),
    copy: (hash) => ctx.env.send('copyReference', { text: hash }),
  };
}
