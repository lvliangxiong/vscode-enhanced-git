import type { Branch, FileChange } from '../../shared/model';
import { git, validHash } from './client';
import { refs } from './refs';
async function selectedBranches(root, values) {
  if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length)
    throw Error('Select distinct branches');
  const all = await refs(root);
  return values.map((value) => {
    const branch: Branch | undefined =
      value === 'HEAD'
        ? all.find((branch) => branch.current) || {
            ref: 'HEAD',
            name: 'HEAD',
            current: true,
            group: 'Local',
          }
        : all.find((b) => b.ref === value);
    if (!branch) throw Error('Selected branch no longer exists');
    return branch;
  });
}

async function branchComparison(root, values) {
  if (!Array.isArray(values) || values.length !== 2) throw Error('Select two branches');
  const pair = await selectedBranches(root, values);
  if (pair[0].ref === pair[1].ref) throw Error('Select two different branches or tags');
  const hashes = await Promise.all(
    pair.map((b) =>
      git(root, ['rev-parse', '--verify', b.ref + '^{commit}']).then((s) => validHash(s.trim())),
    ),
  );
  return pair.map((b, i) => ({ ...b, hash: hashes[i] }));
}

async function branchFiles(root, values) {
  return comparisonFiles(root, await branchComparison(root, values));
}

async function commitComparison(root, values) {
  if (!Array.isArray(values) || values.length !== 2 || new Set(values).size !== 2)
    throw Error('Select two different commits');
  const hashes = await Promise.all(
    values.map((value) =>
      git(root, ['rev-parse', '--verify', validHash(value) + '^{commit}']).then((s) =>
        validHash(s.trim()),
      ),
    ),
  );
  if (hashes[0] === hashes[1]) throw Error('Select two different commits');
  return hashes.map((hash) => ({ ref: hash, hash, name: hash.slice(0, 8), kind: 'commit' }));
}

async function commitFiles(root, values) {
  return comparisonFiles(root, await commitComparison(root, values));
}

async function commitLocalFiles(root, hash) {
  const revision = validHash(
    (await git(root, ['rev-parse', '--verify', validHash(hash) + '^{commit}'])).trim(),
  );
  return comparisonFiles(root, [
    { hash: revision, ref: revision, name: revision.slice(0, 8), kind: 'commit' },
    { name: 'Working Tree', kind: 'workingTree' },
  ]);
}

async function comparisonFiles(root, pair) {
  const raw = await git(root, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '-M',
    '--name-status',
    '-z',
    pair[0].hash,
    ...(pair[1].kind === 'workingTree' ? [] : [pair[1].hash]),
    '--',
  ]);
  const parts = raw.split('\0'),
    files: FileChange[] = [];
  for (let i = 0; i < parts.length - 1;) {
    const status = parts[i++],
      oldPath = parts[i++],
      path = /^[RC]/.test(status) ? parts[i++] : oldPath;
    files.push({
      index: files.length,
      status: status[0],
      path,
      before: status[0] === 'A' ? null : { hash: pair[0].hash, path: oldPath },
      after:
        status[0] === 'D'
          ? null
          : pair[1].kind === 'workingTree'
            ? { workingTree: true, path }
            : { hash: pair[1].hash, path },
    });
  }
  return { pair, files };
}

export {
  selectedBranches,
  branchComparison,
  branchFiles,
  commitComparison,
  commitFiles,
  commitLocalFiles,
  comparisonFiles,
};
