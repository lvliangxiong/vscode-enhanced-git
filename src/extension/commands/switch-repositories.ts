import { realpath } from 'node:fs/promises';
import type * as VSCode from 'vscode';
import { git, validHash } from '../git/client';
import { listWorktrees } from '../git/branch-update';

export async function repositoryBranches(root: string) {
  const output = await git(root, [
    'for-each-ref',
    '--format=%(refname)%00%(symref)',
    'refs/heads/',
    'refs/remotes/',
  ]);
  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [ref, symbolic] = line.split('\0');
      if (symbolic) return [];
      const local = ref.startsWith('refs/heads/');
      const name = local ? ref.slice(11) : ref.slice(13).split('/').slice(1).join('/');
      return name ? [{ name, ref, local }] : [];
    });
}

/** Never force checkout or bypass Git's worktree/dirty-file safety checks. */
export async function switchRepositoryBranch(root: string, name: string): Promise<string> {
  await git(root, ['check-ref-format', '--branch', name]);
  const matches = (await repositoryBranches(root)).filter((branch) => branch.name === name);
  const local = matches.find((branch) => branch.local);
  if (!matches.length) throw new Error(`Branch "${name}" does not exist.`);
  if (local) {
    const current = (await git(root, ['symbolic-ref', '--quiet', 'HEAD']).catch(() => '')).trim();
    if (current === local.ref) return `Already on ${name}.`;
    const occupied = (await listWorktrees(root)).some((tree) => tree.branch === local.ref);
    if (occupied) {
      const hash = validHash(
        (await git(root, ['rev-parse', '--verify', `${local.ref}^{commit}`])).trim(),
      );
      await git(root, ['switch', '--detach', hash]);
      return `${name} is checked out in another worktree; detached at ${hash.slice(0, 8)}.`;
    }
    await git(root, ['switch', '--', name]);
    return `Switched to ${name}.`;
  }
  if (matches.length !== 1)
    throw new Error(
      `Multiple remote branches match "${name}": ${matches.map((b) => b.ref.slice(13)).join(', ')}.`,
    );
  await git(root, ['switch', '-c', name, '--track', matches[0].ref]);
  return `Switched to ${name} (tracking ${matches[0].ref.slice(13)}).`;
}

/** Only independent repositories may switch concurrently. Keep workspace order within a worktree family. */
export async function runSwitchGroups(
  groups: Map<string, string[]>,
  run: (root: string, dir: string) => Promise<void>,
) {
  const queue = groups.entries();
  async function worker() {
    for (const [dir, roots] of queue) {
      for (const root of roots) await run(root, dir);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, groups.size) }, worker));
}

export async function switchRepositories(
  vscode: typeof VSCode,
  discover: () => Promise<string[]>,
  locks: Set<string>,
) {
  const roots = [...new Set(await discover())];
  if (!roots.length) {
    await vscode.window.showWarningMessage('VS Code Git: No Git repositories found in this workspace.');
    return;
  }
  const snapshots = await Promise.all(
    roots.map(async (root) => {
      try {
        return await repositoryBranches(root);
      } catch {
        return [];
      }
    }),
  );
  const counts = new Map<string, number>();
  for (const branches of snapshots) {
    for (const name of new Set(branches.map((branch) => branch.name))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const picker = vscode.window.createQuickPick<VSCode.QuickPickItem>();
  picker.title = 'Switch Branch in All Repositories';
  picker.placeholder = 'Type a branch name — branches do not have to exist in every repository';
  const items = [...counts.keys()].sort().map((name) => ({
    label: name,
    description: `${counts.get(name)}/${roots.length} repositories`,
  }));
  const listeners: VSCode.Disposable[] = [];
  let selected: string | undefined;
  try {
    selected = await new Promise<string | undefined>((resolve) => {
      listeners.push(
        picker.onDidChangeValue((value) => {
          const name = value.trim();
          picker.items =
            name && !counts.has(name)
              ? [...items, { label: name, description: 'Use this branch name' }]
              : items;
        }),
        picker.onDidAccept(() => {
          const name = picker.selectedItems[0]?.label ?? picker.value.trim();
          if (name) {
            resolve(name);
            picker.hide();
          }
        }),
        picker.onDidHide(() => resolve(undefined)),
      );
      picker.show();
    });
  } finally {
    listeners.forEach((listener) => listener.dispose());
    picker.dispose();
  }
  if (!selected) return;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `VS Code Git: Switching to ${selected}`,
    },
    async (progress) => {
      let completed = 0;
      const report = () =>
        progress.report({
          message: `${++completed}/${roots.length}`,
          increment: 100 / roots.length,
        });
      const directories = await Promise.all(
        roots.map(async (root) => {
          try {
            if (locks.has(root)) throw new Error('A Git operation is already running.');
            const dir = await git(root, [
              'rev-parse',
              '--path-format=absolute',
              '--git-common-dir',
            ]);
            return await realpath(dir.trimEnd());
          } catch (error) {
            void vscode.window.showErrorMessage(`VS Code Git — ${root}: ${error.message}`);
            report();
            return undefined;
          }
        }),
      );
      const groups = new Map<string, string[]>();
      roots.forEach((root, index) => {
        const dir = directories[index];
        if (!dir) return;
        const group = groups.get(dir);
        if (group) group.push(root);
        else groups.set(dir, [root]);
      });
      await runSwitchGroups(groups, async (root, dir) => {
        const familyLock = `switch-worktrees:${dir}`;
        if (locks.has(root) || locks.has(familyLock)) {
          void vscode.window.showErrorMessage(
            `VS Code Git — ${root}: A Git operation is already running.`,
          );
          report();
          return;
        }
        locks.add(root);
        locks.add(familyLock);
        try {
          const result = await switchRepositoryBranch(root, selected);
          void vscode.window.showInformationMessage(`VS Code Git — ${root}: ${result}`);
        } catch (error) {
          void vscode.window.showErrorMessage(`VS Code Git — ${root}: ${error.message}`);
        } finally {
          locks.delete(root);
          locks.delete(familyLock);
          report();
        }
      });
    },
  );
}
