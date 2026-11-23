import type { Branch } from './model';

export type ReferenceKind = 'head' | 'local' | 'remote' | 'tag' | 'stash' | 'other';
export interface ReferenceLabel {
  name: string;
  kind: ReferenceKind;
}
export interface ReferenceGroup {
  name: string;
  refs: ReferenceLabel[];
}

/** GitRefManager / SimpleRefGroup presentation rules, adapted for Git decorations. */
export function referenceGroups(
  decorations: string,
  branches: readonly Branch[] = [],
  compact = true,
): ReferenceGroup[] {
  const refs: ReferenceLabel[] = [];
  let current = branches.find((branch) => branch.current)?.name;
  const add = (name: string, kind: ReferenceKind) => {
    if (!refs.some((ref) => ref.name === name && ref.kind === kind)) refs.push({ name, kind });
  };
  for (const value of decorations.split(', ').filter(Boolean)) {
    if (value.startsWith('HEAD -> ')) {
      current = value.slice(8).replace(/^refs\/heads\//, '');
      add('HEAD', 'head');
      add(current, 'local');
    } else if (value === 'HEAD') add(value, 'head');
    else if (value === 'refs/stash') {
      if (!/stash@\{\d+\}/.test(decorations)) add('stash@{0}', 'stash');
    } else if (/^stash@\{\d+\}$/.test(value)) add(value, 'stash');
    else if (value.startsWith('tag: ')) add(value.slice(5).replace(/^refs\/tags\//, ''), 'tag');
    else if (value.startsWith('refs/tags/')) add(value.slice(10), 'tag');
    else if (value.startsWith('refs/heads/')) add(value.slice(11), 'local');
    else if (value.startsWith('refs/remotes/')) add(value.slice(13), 'remote');
    else {
      const branch = branches.find((branch) => branch.name === value || branch.ref === value);
      add(
        branch?.name ?? value,
        branch?.group === 'Remote'
          ? 'remote'
          : branch?.group === 'Tags'
            ? 'tag'
            : branch?.group === 'Local'
              ? 'local'
              : 'other',
      );
    }
  }
  const priority = (ref: ReferenceLabel) =>
    ref.kind === 'head'
      ? 0
      : ref.kind === 'local' && ref.name === current
        ? 1
        : ref.kind === 'local' && ['main', 'master'].includes(ref.name)
          ? 2
          : ref.kind === 'remote' && ['origin/main', 'origin/master'].includes(ref.name)
            ? 3
            : ({ local: 4, remote: 5, tag: 6, stash: 7, other: 8 }[ref.kind] ?? 9);
  refs.sort(
    (a, b) =>
      priority(a) - priority(b) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const remaining = refs.filter((ref) => ref.kind !== 'head');
  const groups: ReferenceGroup[] = [];
  for (const local of remaining.filter((ref) => ref.kind === 'local')) {
    const branch = branches.find(
      (branch) => branch.group === 'Local' && branch.name === local.name,
    );
    const remotes = remaining.filter((ref) => ref.kind === 'remote');
    const remote =
      remotes.find((ref) => ref.name === branch?.upstream?.replace(/^refs\/remotes\//, '')) ??
      remotes.find((ref) => ref.name.endsWith('/' + local.name));
    const remoteName =
      remote &&
      (branches.find((branch) => branch.group === 'Remote' && branch.name === remote.name)
        ?.remote ??
        remote.name.split('/')[0]);
    groups.push({
      name: remote ? `${remoteName} & ${local.name}` : local.name,
      refs: remote ? [local, remote] : [local],
    });
    if (remote) remaining.splice(remaining.indexOf(remote), 1);
    remaining.splice(remaining.indexOf(local), 1);
  }
  if (compact && (groups.length || remaining.length)) {
    const name = groups[0]?.name ?? remaining[0].name;
    const head = refs.filter((ref) => ref.kind === 'head');
    const attached = Boolean(
      current && refs.some((ref) => ref.kind === 'local' && ref.name === current),
    );
    const group = { name, refs: refs.filter((ref) => ref.kind !== 'head' || attached) };
    return head.length && !attached ? [{ name: 'HEAD', refs: head }, group] : [group];
  }
  for (const ref of remaining) {
    const group =
      ref.kind === 'remote' ? undefined : groups.find((group) => group.refs[0].kind === ref.kind);
    if (group) group.refs.push(ref);
    else groups.push({ name: ref.name, refs: [ref] });
  }
  const heads = refs.filter((ref) => ref.kind === 'head');
  if (heads.length) {
    if (current && groups[0]?.refs.some((ref) => ref.kind === 'local' && ref.name === current))
      groups[0].refs.unshift(...heads);
    else groups.unshift({ name: 'HEAD', refs: heads });
  }
  return groups;
}
