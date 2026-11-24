import { git } from '../git/client';
import { branchHead, refs } from '../git/refs';
import { createRef } from '../git/commit-actions';

export async function runBranchTool(
  vscode: typeof import('vscode'),
  root: string,
  action: string,
  ref?: string,
) {
  if (vscode.workspace.isTrusted === false)
    throw Error('Trust this workspace before changing Git references');
  if (action === 'fetch') {
    if (!(await git(root, ['remote'])).trim()) throw Error('No remotes configured');
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Enhanced Git: Fetch' },
      () => git(root, ['fetch', '--all']),
    );
    return { action: 'fetch', message: 'Fetch completed' };
  }
  if (action !== 'new') throw Error('Unsupported branch tool');
  if (!ref) throw Error('Select a branch or HEAD');
  if (
    ref !== 'HEAD' &&
    !(await refs(root)).some((branch) => branch.ref === ref && branch.group !== 'Tags')
  )
    throw Error('Select a branch or HEAD');
  const hash = await branchHead(root, ref);
  const name = await vscode.window.showInputBox({
    title: 'New Branch',
    prompt: `Create from ${ref.replace(/^refs\/(heads|remotes)\//, '')}`,
    validateInput: async (value) => {
      try {
        if (!value || value.startsWith('-')) return 'Enter a valid branch name';
        await git(root, ['check-ref-format', '--branch', value]);
        if ((await refs(root)).some((branch) => branch.ref === `refs/heads/${value}`))
          return 'Branch already exists';
        return undefined;
      } catch {
        return 'Enter a valid branch name';
      }
    },
  });
  if (!name) return undefined;
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: 'Create and Checkout',
        description: 'Create the branch and switch to it',
        checkout: true,
      },
      { label: 'Create Branch', description: 'Keep the current checkout', checkout: false },
    ],
    { title: `New Branch: ${name}` },
  );
  if (!choice) return undefined;
  await createRef(root, hash, 'branch', { name, checkout: choice.checkout });
  return { action: choice.checkout ? 'checkout' : 'create', message: `Created branch: ${name}` };
}
