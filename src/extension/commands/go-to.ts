import type { QuickPickItem } from 'vscode';
import { refs } from '../git/refs';
import { navigationRefs, resolveLogDestination } from '../git/navigation';

interface DestinationItem extends QuickPickItem {
  value: string;
}

export async function pickLogDestination(
  vscode: typeof import('vscode'),
  root: string,
): Promise<string | undefined> {
  const branches = navigationRefs(await refs(root));
  const choices: DestinationItem[] = [
    { label: 'HEAD', description: 'Current checkout', value: 'HEAD' },
    ...branches.map((branch) => ({
      label: branch.name,
      description: branch.group,
      value: branch.ref,
    })),
  ];
  const picker = vscode.window.createQuickPick<DestinationItem>();
  const title = 'Go to Hash / Branch / Tag';
  picker.title = title;
  picker.placeholder = 'Enter a commit hash or choose a branch or tag';
  picker.items = choices;
  return new Promise((resolve) => {
    let finished = false;
    const subscriptions: import('vscode').Disposable[] = [];
    const finish = (hash?: string) => {
      if (finished) return;
      finished = true;
      subscriptions.forEach((subscription) => subscription.dispose());
      picker.dispose();
      resolve(hash);
    };
    subscriptions.push(picker.onDidHide(() => finish()));
    subscriptions.push(
      picker.onDidChangeValue((value) => {
        picker.title = title;
        const text = value.trim();
        // Free input is essential: the commit need not be in the loaded log page.
        picker.items = text
          ? [
              {
                label: text,
                description: 'Go to hash or reference',
                value: text,
                alwaysShow: true,
              },
              ...choices,
            ]
          : choices;
      }),
    );
    subscriptions.push(
      picker.onDidAccept(async () => {
        if (picker.busy) return;
        const value = picker.selectedItems[0]?.value || picker.value.trim();
        if (!value) return;
        picker.busy = true;
        picker.enabled = false;
        try {
          const hash = await resolveLogDestination(root, value);
          finish(hash);
        } catch (error) {
          if (!finished) {
            picker.title = error.message;
            picker.busy = false;
            picker.enabled = true;
          }
        }
      }),
    );
    picker.show();
  });
}
