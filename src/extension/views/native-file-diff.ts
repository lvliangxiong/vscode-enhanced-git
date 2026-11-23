import type * as VSCode from 'vscode';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { FileHistoryDiff } from '../../shared/file-history';

/** Map only host-created history snapshots to their current working-tree file.
 * Pinned native tabs retain their mapping even after the sidebar changes files. */
export function registerHistoryDiffFiles(vscode: typeof VSCode, context: VSCode.ExtensionContext) {
  const files = new Map<string, VSCode.Uri>();
  context.subscriptions.push(
    vscode.commands.registerCommand('vsgit.fileHistory.openFile', async (resource?: VSCode.Uri) => {
      const input = vscode.window.tabGroups?.activeTabGroup.activeTab
        ?.input as VSCode.TabInputTextDiff;
      const uri = resource || input?.modified || vscode.window.activeTextEditor?.document.uri;
      const file = uri && files.get(uri.toString());
      if (!file) return;
      try {
        await fs.stat(file.fsPath);
        await vscode.commands.executeCommand('vscode.open', file, {
          viewColumn: vscode.ViewColumn.Active,
          preview: false,
        });
      } catch (error) {
        if (error.code === 'ENOENT')
          void vscode.window.showInformationMessage(
            `The file no longer exists in the working tree: ${file.fsPath}`,
          );
        else void vscode.window.showErrorMessage(`VS Git: ${error.message}`);
      }
    }),
    { dispose: () => files.clear() },
  );
  return files;
}

/** Own a stable preview in the requested editor group. Never rearrange
 * existing groups, close user tabs, or write historical contents to disk. */
export function nativeFileDiff(
  vscode: typeof VSCode,
  column: () => VSCode.ViewColumn,
  snapshots: Map<string, string>,
  workingFile: VSCode.Uri,
  files: Map<string, VSCode.Uri>,
) {
  let current: { left: VSCode.Uri; right: VSCode.Uri; title: string };
  const pairs = new Map<string, typeof current>();
  let disposed = false;
  const sweep = () => {
    const groups = vscode.window.tabGroups;
    if (!groups) return;
    const opened = new Set<string>();
    for (const group of groups.all)
      for (const tab of group.tabs) {
        const input = tab.input as VSCode.TabInputTextDiff;
        if (input?.original && input.modified) {
          opened.add(input.original.toString());
          opened.add(input.modified.toString());
        }
      }
    for (const [key, pair] of pairs) {
      if (!disposed && pair === current) continue;
      if (opened.has(pair.left.toString()) || opened.has(pair.right.toString())) continue;
      snapshots.delete(pair.left.toString());
      snapshots.delete(pair.right.toString());
      files.delete(pair.left.toString());
      files.delete(pair.right.toString());
      pairs.delete(key);
    }
    if (disposed && !pairs.size) tabsListener?.dispose();
  };
  const tabsListener = vscode.window.tabGroups?.onDidChangeTabs(sweep);
  const reveal = async () => {
    if (!current || disposed) return;
    await vscode.commands.executeCommand(
      'vscode.diff',
      current.left,
      current.right,
      current.title,
      { viewColumn: column(), preserveFocus: true, preview: true },
    );
    sweep();
  };
  return {
    async open(data: FileHistoryDiff) {
      if (disposed) return;
      const key = createHash('sha256')
        .update(JSON.stringify([data.beforeLabel, data.afterLabel, ...data.contents]))
        .digest('hex');
      if (!pairs.has(key)) {
        const make = (text: string, side: number) => {
          const uri = vscode.Uri.from({
            scheme: 'vsgit-history',
            path: '/' + data.path,
            query: new URLSearchParams({
              snapshot: randomUUID(),
              revision: side ? data.afterLabel : data.beforeLabel,
            }).toString(),
          });
          snapshots.set(uri.toString(), text);
          files.set(uri.toString(), workingFile);
          return uri;
        };
        pairs.set(key, {
          left: make(data.contents[0], 0),
          right: make(data.contents[1], 1),
          title: `${data.path.split('/').pop()} (${data.beforeLabel.match(/\(([a-f0-9]{8})\)$/)?.[1] || data.beforeLabel}) ↔ ${data.path.split('/').pop()} (${data.afterLabel.match(/\(([a-f0-9]{8})\)$/)?.[1] || data.afterLabel})`,
        });
      }
      current = pairs.get(key);
      await reveal();
    },
    dispose() {
      disposed = true;
      sweep();
      if (!vscode.window.tabGroups) pairs.clear(); /* Minimal hosts cannot track open tabs. */
    },
  };
}
