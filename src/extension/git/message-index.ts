import { setImmediate as yieldToHost } from 'node:timers/promises';

// Hash collisions only add candidates: the caller verifies the complete message.
function grams(text: string) {
  const result = new Set<number>();
  for (let i = 2; i < text.length; i++) {
    let key = 2166136261;
    for (let j = i - 2; j <= i; j++) key = Math.imul(key ^ text.charCodeAt(j), 16777619);
    result.add(key >>> 0);
  }
  return result;
}

export interface MessageIndexState {
  postings: Map<number, Uint32Array>;
  overflow: number[];
  size: number;
  count: number;
}

export async function createMessageIndex(
  messages: string[],
  { maxPostings = 2_000_000, maxKeys = 65_536, maxLength = 8192 } = {},
  previous?: MessageIndexState,
) {
  const building = new Map<number, number[]>();
  const postings = new Map(previous?.postings);
  const overflow: number[] = [...(previous?.overflow || [])];
  let size = previous?.size || 0;
  let addedKeys = 0;
  for (const [offset, message] of messages.entries()) {
    const row = (previous?.count || 0) + offset;
    if (row % 256 === 0) await yieldToHost();
    if (message.length > maxLength) {
      overflow.push(row);
      continue;
    }
    const keys = grams(message);
    const newKeys = [...keys].filter((key) => !building.has(key) && !postings.has(key)).length;
    if (size + keys.size > maxPostings || postings.size + addedKeys + newKeys > maxKeys) {
      // Unindexed messages are always included, never silently omitted.
      overflow.push(row);
      continue;
    }
    size += keys.size;
    addedKeys += newKeys;
    for (const key of keys) {
      let rows = building.get(key);
      if (!rows) building.set(key, (rows = []));
      rows.push(row);
    }
  }
  for (const [key, rows] of building) {
    const before = postings.get(key);
    const combined = new Uint32Array((before?.length || 0) + rows.length);
    if (before) combined.set(before);
    combined.set(rows, before?.length || 0);
    postings.set(key, combined);
  }
  building.clear();
  return {
    state: { postings, overflow, size, count: (previous?.count || 0) + messages.length },
    keys: postings.size,
    bytes: size * 4,
    candidates(query: string): number[] | undefined {
      if (query.length < 3) return undefined;
      // The rarest trigram is sufficient for a conservative candidate set;
      // exact matching afterwards also removes hash collisions.
      let smallest: Uint32Array;
      for (const key of grams(query)) {
        const rows = postings.get(key);
        if (!rows) return [...overflow];
        if (!smallest || rows.length < smallest.length) smallest = rows;
      }
      return [...smallest, ...overflow].sort((a, b) => a - b);
    },
  };
}
