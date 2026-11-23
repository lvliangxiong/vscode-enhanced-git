import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
async function git(
  root: string,
  args: string[],
  options: { maxBuffer?: number; input?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const pending = exec('git', ['-C', root, ...args], {
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    timeout: 60000,
    encoding: 'utf8',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  pending.child.stdin.on('error', () => {
    /* exec reports an early Git exit. */
  });
  pending.child.stdin.end(options.input);
  const { stdout } = await pending;
  return stdout;
}

function validHash(hash: string): string {
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error('Invalid commit');
  return hash;
}

export { git, validHash };
