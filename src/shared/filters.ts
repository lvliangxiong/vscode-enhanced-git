import type { Branch, Author, RecentKind, RecentGroups } from './model';
type Reference = Pick<Branch, 'name' | 'ref'>;
const parseValues = (text: string, kind: string) => [
  ...new Set(
    text
      .split(kind === 'paths' ? /\n/ : /[|\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
const sameValues = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v) => b.includes(v));
const remember = (groups: string[][], values: string[]) =>
  values.length
    ? [[...values], ...groups.filter((g) => !sameValues(g, values))].slice(0, 10)
    : groups;
const forget = (groups: string[][], values: string[]) =>
  groups.filter((g) => !sameValues(g, values));
const valuesLabel = (values: string[]) => values.join('|');
function branchValueLabel(value: string, branches: Reference[]) {
  const name = (ref) =>
    branches.find((branch) => branch.ref === ref)?.name ||
    (/[*+?\[\]{}()^$\\]/.test(ref) ? ref : ref.replace(/^refs\/(?:heads|remotes)\//, ''));
  const exact = branches.find((branch) => branch.ref === value);
  if (exact) return exact.name;
  const range = value.split('..');
  if (range.length === 2 && range.every(Boolean)) return range.map(name).join('..');
  return value.startsWith('-') ? '-' + name(value.slice(1)) : name(value);
}
// Speed search accepts both substrings and abbreviated names (as in Rebased).
function matchPositions(label: string, query: string) {
  const text = label.toLowerCase(),
    needle = query.toLowerCase().trim();
  if (!needle) return [];
  const direct = text.indexOf(needle);
  if (direct >= 0) return Array.from({ length: needle.length }, (_, i) => direct + i);
  const pattern = needle.replace(/\s+/g, ''),
    boundary = (i) =>
      i === 0 ||
      /[^a-z0-9]/i.test(label[i - 1]) ||
      (/[a-z]/.test(label[i - 1]) && /[A-Z]/.test(label[i]));
  const failed = new Set();
  function find(part, from) {
    if (part === pattern.length) return [];
    const key = part + ':' + from;
    if (failed.has(key)) return null;
    for (
      let at = text.indexOf(pattern[part], from);
      at >= 0;
      at = text.indexOf(pattern[part], at + 1)
    ) {
      if (!(part > 0 && at === from) && !boundary(at)) continue;
      const rest = find(part + 1, at + 1);
      if (rest) return [at, ...rest];
    }
    failed.add(key);
    return null;
  }
  return find(0, 0);
}
function searchEntries(items, query) {
  const result = [];
  let heading;
  for (const entry of items) {
    if (entry.heading || entry.separator) {
      heading = entry;
      continue;
    }
    if (entry.children) {
      const children = searchEntries(entry.children, query);
      if (children.length)
        result.push(
          { heading: entry.label, ...(entry.clearRecent ? { clearRecent: true } : {}) },
          ...children,
        );
      heading = undefined;
      continue;
    }
    const matches = matchPositions(entry.label, query);
    if (matches === null && !entry.value?.some((value) => matchPositions(value, query) !== null))
      continue;
    if (heading && result.length) result.push(heading);
    else if (heading?.heading) result.push(heading);
    heading = undefined;
    result.push({ ...entry, matches: matches || [] });
  }
  return result;
}
function recentEntries(
  kind: RecentKind,
  m: { recents: RecentGroups; root: string; branches: Reference[]; paths: string[] },
) {
  const groups = (m.recents[kind] || []).filter((values) => Array.isArray(values) && values.length);
  const pathKey = (value) =>
    value.startsWith('/') ? value.replace(/\/$/, '') : (m.root + '/' + value).replace(/\/$/, '');
  return groups
    .filter((values) => {
      if (kind !== 'branch' || !m.branches.length) return true;
      try {
        const result = branchSelection(values, m.branches);
        return result.revisions.length || result.ranges.length;
      } catch {
        return false;
      }
    })
    .map((value) =>
      kind === 'paths'
        ? {
            label: value
              .map((p) => (p.startsWith(m.root + '/') ? p.slice(m.root.length + 1) : p))
              .join(', '),
            value,
            recent: true,
            checked: sameValues(value.map(pathKey), m.paths.map(pathKey)),
            addRecent: false,
          }
        : kind === 'branch'
          ? {
              label: valuesLabel(value.map((item) => branchValueLabel(item, m.branches))),
              displayValues: value.map((item) => branchValueLabel(item, m.branches)),
              value,
              recent: true,
            }
          : { label: valuesLabel(value), value, recent: true },
    );
}
function branchSelection(values: string[], branches: Reference[]) {
  const candidates = [{ name: 'HEAD', ref: 'HEAD' }, ...branches];
  const positive = [],
    negative = [],
    revisions = [],
    ranges = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value || value.includes('\0') || value.startsWith('--'))
      throw Error('Invalid branch filter');
    if (/^[a-f0-9]{40,64}$/i.test(value)) {
      revisions.push(value);
      continue;
    }
    if (value.includes('..')) {
      const ends = value.split('..');
      if (ends.length !== 2 || ends.some((s) => !s || s.startsWith('-') || /[\s\0]/.test(s)))
        throw Error('Use a range such as main..feature');
      for (const end of ends)
        if (
          !candidates.some((b) => b.name === end || b.ref === end) &&
          !/^[a-f0-9]{4,64}$/i.test(end)
        )
          throw Error(`Unknown range endpoint: ${end}`);
      ranges.push(ends);
      continue;
    }
    const exclude = value.startsWith('-'),
      pattern = exclude ? value.slice(1) : value;
    const exact = candidates.filter((b) => b.name === pattern || b.ref === pattern);
    let matches;
    if (exact.length) matches = (b) => exact.includes(b);
    else {
      let regex;
      try {
        regex = new RegExp(`^(?:${pattern})$`);
      } catch {
        throw Error(`Invalid branch pattern: ${pattern}`);
      }
      matches = (b) => regex.test(b.name);
    }
    (exclude ? negative : positive).push(matches);
  }
  const hasBranchPatterns = positive.length || negative.length;
  if (hasBranchPatterns)
    revisions.push(
      ...candidates
        .filter(
          (b) => (!positive.length || positive.some((m) => m(b))) && !negative.some((m) => m(b)),
        )
        .map((b) => b.ref),
    );
  return { revisions: [...new Set(revisions)], ranges };
}
function resolveUsers(values: string[], authors: Author[], current: Author) {
  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const matches = (a, q) =>
    a.email.toLowerCase() === q.toLowerCase() ||
    normalize(a.name) === normalize(q) ||
    normalize(a.email.split('@')[0]) === normalize(q);
  return authors.filter((a) =>
    values.some((q) =>
      q === 'me'
        ? Boolean(current.email) &&
          (a.email.toLowerCase() === current.email.toLowerCase() ||
            normalize(a.name) === normalize(current.name || current.email.split('@')[0]))
        : matches(a, q),
    ),
  );
}

export {
  branchValueLabel,
  parseValues,
  sameValues,
  valuesLabel,
  remember,
  forget,
  recentEntries,
  branchSelection,
  resolveUsers,
  matchPositions,
  searchEntries,
};
