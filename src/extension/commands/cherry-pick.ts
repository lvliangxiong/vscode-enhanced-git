import {
  cherryPickPending,
  executeCherryPick,
  prepareCherryPick,
  recoverCherryPick,
} from '../git/cherry-pick';

// Shared by the commit context menu and toolbar; the caller owns the repository lock.
export async function runCherryPick(
  vscode: typeof import('vscode'),
  root: string,
  hashes: string[],
): Promise<boolean> {
  if (vscode.workspace.isTrusted === false)
    throw Error('Trust this workspace before cherry-picking');
  const pending = await cherryPickPending(root);
  let operation: () => Promise<void>;
  if (pending) {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: 'Continue',
          description: 'Resolve conflicts and stage the resolved files first',
          action: 'continue' as const,
        },
        {
          label: 'Skip',
          description: 'Discard the current pick and continue with the remaining commits',
          action: 'skip' as const,
        },
        {
          label: 'Abort',
          description: 'Cancel the sequence and return to its starting state',
          action: 'abort' as const,
        },
      ],
      { title: 'Cherry-pick in progress' },
    );
    if (!choice) return false;
    if (choice.action !== 'continue') {
      const accepted = await vscode.window.showWarningMessage(
        choice.description,
        { modal: true },
        choice.label,
      );
      if (accepted !== choice.label) return false;
    }
    operation = () => recoverCherryPick(root, choice.action);
  } else {
    const plan = await prepareCherryPick(root, hashes);
    const accepted = await vscode.window.showWarningMessage(
      `Cherry-pick ${plan.hashes.length} commit(s) onto ${plan.branch.replace(/^refs\/heads\//, '')}?`,
      {
        modal: true,
        detail:
          'Execution order (bottom to top in the log):\n' +
          plan.hashes.map((hash, i) => `${hash.slice(0, 8)} ${plan.subjects[i]}`).join('\n'),
      },
      'Cherry-pick',
    );
    if (accepted !== 'Cherry-pick') return false;
    operation = () => executeCherryPick(root, plan);
  }
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Enhanced Git: Cherry-pick' },
      operation,
    );
    return true;
  } catch (error) {
    if (await cherryPickPending(root)) {
      void vscode.window
        .showWarningMessage(
          'Cherry-pick stopped. Resolve and stage conflicts in Source Control, then click Cherry-pick again for Continue / Skip / Abort. An empty pick can be skipped.',
          'Open Source Control',
        )
        .then((choice) => {
          if (choice === 'Open Source Control')
            return vscode.commands.executeCommand('workbench.view.scm');
        });
      throw Error(
        `${error.message}\nCherry-pick remains in progress. Click Cherry-pick for Continue / Skip / Abort.`,
      );
    }
    throw error;
  }
}
