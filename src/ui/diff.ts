import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Opens a native VS Code diff view between original and rewritten text.
 * Uses in-memory untitled documents so selected text never touches disk.
 * Shows persistent Accept / Discard buttons in the status bar.
 * Returns true if the user accepted, false otherwise.
 */
export async function showDiffAndPrompt(
  original: string,
  rewritten: string
): Promise<boolean> {
  const token = crypto.randomBytes(16).toString('hex');
  const origUri = vscode.Uri.parse(`untitled:DeSlop-original-${token}.txt`);
  const rewrittenUri = vscode.Uri.parse(`untitled:DeSlop-rewritten-${token}.txt`);

  const edit = new vscode.WorkspaceEdit();
  edit.insert(origUri, new vscode.Position(0, 0), original);
  edit.insert(rewrittenUri, new vscode.Position(0, 0), rewritten);
  await vscode.workspace.applyEdit(edit);

  let choice: 'Accept' | 'Discard' | undefined;

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      origUri,
      rewrittenUri,
      'DeSlop: Review Changes'
    );

    choice = await waitForStatusBarChoice();

    const tabsToClose = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((tab) => {
        if (tab.input instanceof vscode.TabInputTextDiff) {
          const d = tab.input as vscode.TabInputTextDiff;
          return (
            d.original.toString() === origUri.toString() ||
            d.modified.toString() === rewrittenUri.toString()
          );
        }
        return false;
      });

    for (const tab of tabsToClose) {
      try { await vscode.window.tabGroups.close(tab); } catch { /* ignore */ }
    }
  } finally {
    // Nothing to clean up — in-memory documents are discarded with the tab.
  }

  return choice === 'Accept';
}

/**
 * Shows Accept and Discard as clickable status bar buttons.
 * Resolves when the user clicks either one.
 */
function waitForStatusBarChoice(): Promise<'Accept' | 'Discard'> {
  return new Promise((resolve) => {
    const acceptCmd = 'deslop._acceptRewrite';
    const discardCmd = 'deslop._discardRewrite';

    const acceptItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    acceptItem.text = '$(check) Accept rewrite';
    acceptItem.tooltip = 'Apply the deslopped text';
    acceptItem.command = acceptCmd;
    acceptItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');

    const discardItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
    discardItem.text = '$(x) Discard';
    discardItem.tooltip = 'Keep the original text';
    discardItem.command = discardCmd;

    const acceptReg = vscode.commands.registerCommand(acceptCmd, () => cleanup('Accept'));
    const discardReg = vscode.commands.registerCommand(discardCmd, () => cleanup('Discard'));

    acceptItem.show();
    discardItem.show();

    function cleanup(picked: 'Accept' | 'Discard') {
      acceptItem.dispose();
      discardItem.dispose();
      acceptReg.dispose();
      discardReg.dispose();
      resolve(picked);
    }
  });
}
