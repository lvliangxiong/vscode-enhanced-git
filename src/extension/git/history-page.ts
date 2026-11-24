import type { HistoryFilters } from '../../shared/model';
import { historyThrough, log, type HistoryContext } from './history';

// Unlimited mode still gets a small first frame; the requested limit is loaded afterwards.
export const firstBlockLimit = (limit: number) => Math.min(limit || 200, 200);

export function historyLoading(initialCount: unknown = 500, pageSize: unknown = 500) {
  return {
    initialCount:
      typeof initialCount === 'number' && Number.isSafeInteger(initialCount) && initialCount >= 0
        ? initialCount
        : 500,
    pageSize:
      typeof pageSize === 'number' && Number.isFinite(pageSize)
        ? Math.max(100, Math.min(2000, Math.floor(pageSize)))
        : 500,
  };
}

export function historyRequestLimit(
  settings: ReturnType<typeof historyLoading>,
  request: { type?: string; limit?: unknown; initialCount?: unknown; resetLimit?: boolean },
  loadedCount: number,
) {
  const { initialCount, pageSize } = settings;
  // Zero is an explicit unlimited mode, never a fallback to the default page size.
  if (
    initialCount === 0 ||
    ['init', 'repo'].includes(request.type ?? '') ||
    request.resetLimit === true ||
    (request.initialCount !== undefined && request.initialCount !== initialCount)
  )
    return initialCount;
  const requested = Number(request.limit);
  return Math.max(
    initialCount,
    Math.min(
      Math.max(initialCount, loadedCount + pageSize),
      Number.isSafeInteger(requested) && requested > 0 ? requested : loadedCount,
    ),
  );
}

export async function loadHistoryPage(
  root: string,
  ref: string | string[],
  limit: number,
  filters: HistoryFilters = {},
  target?: string,
  pageSize = 500,
  context?: HistoryContext,
) {
  if (target) {
    const loaded = await historyThrough(root, ref, limit, filters, target, pageSize, context);
    const historyLimit =
      limit === 0 ? 0 : Math.max(limit, Math.ceil(loaded.history.length / pageSize) * pageSize);
    return {
      ...loaded,
      historyLimit,
      hasMore: historyLimit > 0 && loaded.history.length >= historyLimit,
    };
  }
  const loaded = await log(
    root,
    ref,
    limit === 0 ? 0 : limit + 1,
    filters,
    undefined,
    pageSize,
    context,
  );
  return {
    history: limit === 0 ? loaded : loaded.slice(0, limit),
    historyLimit: limit,
    hasMore: limit > 0 && loaded.length > limit,
    ref,
    filters,
    reset: false,
  };
}
