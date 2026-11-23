import { createHash } from 'node:crypto';
import { git } from './client';
import { topologyIdentity } from './topology-identity';

export async function historyIdentity(root: string) {
  return (await historyState(root)).identity;
}

export async function historyState(root: string) {
  const inputs = await Promise.all([
    topologyIdentity(root),
    git(root, ['config', '--null', '--list']),
  ]);
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const [refs, , shallow, grafts] = JSON.parse(inputs[0]);
  const replacements = refs
    .split('\n')
    .filter((line: string) =>
      line.includes(' ' + (process.env.GIT_REPLACE_REF_BASE || 'refs/replace/')),
    );
  return {
    identity: hash(inputs),
    // Ordinary ref moves only change reachability/decorations. Replacements,
    // grafts, shallow boundaries and decoding config can change stored details.
    compatibility: hash([inputs[1], replacements, shallow, grafts]),
  };
}
