import { readStashes } from './stashes';
import { branchSelection, resolveUsers } from '../../shared/filters';
import type { HistoryFilters, Commit, Branch, Author } from '../../shared/model';
import { git, validHash } from './client';
import { refs, readAuthors, relativePath } from './refs';
// A validated repository snapshot supplies metadata shared by every filter request.
export interface HistoryContext {
  indexed?: (
    ref: string | string[],
    limit: number,
    filters: HistoryFilters,
  ) => Promise<Commit[] | undefined> | undefined;
  readPaths?: (args: string[]) => Promise<string>;
  branches: () => Promise<Branch[]>;
  users: () => Promise<[Author[], string, string]>;
}
async function log(
  root: string,
  ref: string | string[],
  limit = 500,
  filters: HistoryFilters = {},
  target?: string,
  pageSize = 500,
  context?: HistoryContext,
): Promise<Commit[]> {
  const indexed = !target && (await context?.indexed?.(ref, limit, filters));
  if (indexed) return indexed;
  const stashes = await readStashes(root);
  const queryLimit = limit > 0 ? limit + stashes.internal.size : 0;
  const order = filters.sort === 'topological' ? '--topo-order' : '--date-order';
  const format = '--format=%H%x00%P%x00%an%x00%ae%x00%cI%x00%s%x00%D%x00%aI%x00';
  const args = [
    'log',
    order,
    ...(limit > 0 ? [`--max-count=${queryLimit}`] : []),
    filters.showSignature ? format.replace('%aI%x00', '%aI%x00%G?%x00') : format,
  ];
  const removeLimit = () => {
    const index = args.findIndex((arg) => arg.startsWith('--max-count='));
    if (index >= 0) args.splice(index, 1);
  };
  // History can intentionally exceed the ordinary command output cap.
  const read = (args: string[]) =>
    filters.paths?.length && context?.readPaths
      ? context.readPaths(args)
      : git(root, args, { maxBuffer: Infinity });
  const selectedRefs = Array.isArray(ref) ? ref : ref ? [ref] : [];
  let allowedHashes;
  if (selectedRefs.length) {
    const selection = branchSelection(
      selectedRefs,
      await (context?.branches() ?? refs(root, { tracking: false })),
    );
    if (!selection.revisions.length && !selection.ranges.length) return [];
    args.push(...selection.revisions, ...selection.ranges.map((range) => range[1]));
    if (selection.ranges.length) {
      // Union each range separately: passing several A..B pairs to Git would
      // subtract all left endpoints globally, losing commits from other ranges.
      const groups = [
        ...selection.ranges.map(([a, b]) => [`${a}..${b}`]),
        ...(selection.revisions.length ? [selection.revisions] : []),
      ];
      allowedHashes = new Set(
        (await Promise.all(groups.map((group) => read(['rev-list', ...group, '--'])))).flatMap(
          (s) => s.trim().split('\n').filter(Boolean),
        ),
      );
      removeLimit();
    }
  } else args.push('--all', ...stashes.revisions);
  const escapePattern = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  args.push('--extended-regexp');
  if (!filters.matchCase) args.push('--regexp-ignore-case');
  for (const email of filters.authors || []) args.push(`--author=<${escapePattern(email)}>$`);
  if (filters.authorQueries?.length) {
    const [authors, email, name] = await (context?.users() ??
      Promise.all([
        readAuthors(root),
        git(root, ['config', '--get', 'user.email']).catch(() => ''),
        git(root, ['config', '--get', 'user.name']).catch(() => ''),
      ]));
    const matches = resolveUsers(filters.authorQueries, authors, {
      email: email.trim(),
      name: name.trim(),
    });
    if (!matches.length) return [];
    for (const author of matches)
      args.push(`--author=^${escapePattern(author.name)} <${escapePattern(author.email)}>$`);
  }
  if (filters.author) args.push(`--author=${escapePattern(filters.author)}`);
  if (filters.sinceHours) {
    if (![24, 168].includes(filters.sinceHours)) throw new Error('Invalid relative date');
    args.push(`--since=@${Math.floor(Date.now() / 1000 - filters.sinceHours * 3600)} +0000`);
  }
  for (const [key, flag] of [
    ['since', '--since'],
    ['until', '--until'],
  ]) {
    if (filters[key]) {
      const value = filters[key];
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)
      )
        throw Error('Invalid date');
      const timestamp = Date.parse(
        value.length === 10 ? value + `T${key === 'since' ? '00:00:00' : '23:59:59'}` : value,
      );
      // Include the offset to force Git's exact raw-date parser. Bare @timestamps
      // in the future otherwise fall back to the approximate-date parser.
      args.push(`${flag}=@${Math.floor(timestamp / 1000)} +0000`);
    }
  }
  if (filters.hideMerges) {
    if (stashes.entries.size) removeLimit();
    else args.push('--no-merges');
  }
  if (filters.firstParent) args.push('--first-parent');
  // Search full commit messages, or exact hexadecimal hash prefixes, before limiting results.
  const query = String(filters.text || '').trim();
  const hashQuery = /^[a-f0-9]{4,64}$/i.test(query);
  if (query && !hashQuery) args.push(`--grep=${filters.regex ? query : escapePattern(query)}`);
  if (hashQuery && !allowedHashes) removeLimit();
  args.push('--');
  if (filters.paths) {
    for (const path of filters.paths) args.push(`:(literal)${relativePath(root, path)}`);
  }
  if (target) validHash(target);
  if (target && limit > 0) {
    const scan = args
      .filter((arg) => !arg.startsWith('--max-count='))
      .map((arg) => (arg.startsWith('--format=') ? '--format=%H' : arg));
    const hashes = (await read(scan))
      .trim()
      .split('\n')
      .filter(
        (hash) =>
          !stashes.internal.has(hash) &&
          (!hashQuery || hash.startsWith(query.toLowerCase())) &&
          (!allowedHashes || allowedHashes.has(hash)),
      );
    const index = hashes.indexOf(target);
    if (index < 0) return [];
    limit = Math.max(limit, Math.ceil((index + 1) / pageSize) * pageSize);
    const max = args.findIndex((arg) => arg.startsWith('--max-count='));
    if (max >= 0) args[max] = `--max-count=${limit + stashes.internal.size}`;
  }
  let raw;
  try {
    if (hashQuery) {
      const hashArgs = args.map((arg) => (arg.startsWith('--format=') ? '--format=%H' : arg));
      const matching = (await read(hashArgs))
        .trim()
        .split('\n')
        .filter(
          (hash) =>
            !stashes.internal.has(hash) &&
            hash.startsWith(query.toLowerCase()) &&
            (!allowedHashes || allowedHashes.has(hash)),
        )
        .slice(0, limit || undefined);
      if (!matching.length) return [];
      raw = await read([
        'log',
        '--no-walk',
        '--date-order',
        args.find((arg) => arg.startsWith('--format='))!,
        ...matching,
        '--',
      ]);
    } else raw = await read(args);
  } catch (error) {
    if ((await git(root, ['rev-list', '--all', '--count'])).trim() === '0') return [];
    throw error;
  }
  let result = raw
    .split('\0\n')
    .filter(Boolean)
    .map((row) => {
      const [hash, parents, author, email, date, subject, decorations, authorDate, signature] = row
        .replace(/^\n/, '')
        .split('\0');
      return {
        hash,
        parents: parents.split(' ').filter(Boolean),
        author,
        email,
        date,
        subject,
        decorations,
        authorDate,
        signature,
      };
    });
  result = stashes.visible(result);
  if (filters.hideMerges) result = result.filter((commit) => commit.parents.length < 2);
  if (hashQuery)
    result = result
      .filter((c) => c.hash.startsWith(query.toLowerCase()))
      .slice(0, limit || undefined);
  if (allowedHashes)
    result = result.filter((c) => allowedHashes.has(c.hash)).slice(0, limit || undefined);
  return result.slice(0, limit || undefined);
}
// Sparse filtered edges follow Rebased's DottedFilterEdgesGenerator two-pass
// algorithm (JetBrains, Apache-2.0; see THIRD_PARTY_NOTICES.md).

async function historyThrough(
  root: string,
  ref: string | string[],
  limit: number,
  filters: HistoryFilters,
  target: string,
  pageSize = 500,
  context?: HistoryContext,
) {
  validHash(target);
  let history = await log(root, ref, limit, filters, target, pageSize, context);
  if (history.some((c) => c.hash === target)) return { history, ref, filters, reset: false };
  const clear = { sort: filters.sort, showSignature: filters.showSignature };
  history = await log(root, ref, limit, clear, target, pageSize, context);
  if (!history.some((c) => c.hash === target)) {
    ref = '';
    history = await log(root, ref, limit, clear, target, pageSize, context);
  }
  if (!history.some((c) => c.hash === target))
    throw Error(
      'Target commit is unavailable in this repository. Fetch its history and try again.',
    );
  return { history, ref, filters: clear, reset: true };
}

export { log, historyThrough };
