import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Opens a native VS Code diff view between original and rewritten text.
 * Shows persistent Accept / Discard buttons in the status bar so the user
 * can review the diff freely before deciding.
 * Returns true if the user accepted, false otherwise.
 */
export async function showDiffAndPrompt(
  original: string,
  rewritten: string
): Promise<boolean> {
  const ts = Date.now();
  const tmpDir = os.tmpdir();
  const origFile = path.join(tmpDir, `humanizer-original-${ts}.txt`);
  const rewrittenFile = path.join(tmpDir, `humanizer-rewritten-${ts}.txt`);

  fs.writeFileSync(origFile, original, 'utf8');
  fs.writeFileSync(rewrittenFile, rewritten, 'utf8');

  let choice: 'Accept' | 'Discard' | undefined;

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(origFile),
      vscode.Uri.file(rewrittenFile),
      'Humanizer: Review Changes'
    );

    choice = await waitForStatusBarChoice();

    // Close the diff tab
    const tabsToClose = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((tab) => {
        if (tab.input instanceof vscode.TabInputTextDiff) {
          const d = tab.input as vscode.TabInputTextDiff;
          return d.original.fsPath === origFile || d.modified.fsPath === rewrittenFile;
        }
        return false;
      });

    for (const tab of tabsToClose) {
      try { await vscode.window.tabGroups.close(tab); } catch { /* ignore */ }
    }
  } finally {
    try { fs.unlinkSync(origFile); } catch { /* ignore */ }
    try { fs.unlinkSync(rewrittenFile); } catch { /* ignore */ }
  }

  return choice === 'Accept';
}

/**
 * Shows Accept and Discard as clickable status bar buttons.
 * Resolves when the user clicks either one.
 */
function waitForStatusBarChoice(): Promise<'Accept' | 'Discard'> {
  return new Promise((resolve) => {
    const acceptCmd = 'humanizer._acceptRewrite';
    const discardCmd = 'humanizer._discardRewrite';

    const acceptItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    acceptItem.text = '$(check) Accept rewrite';
    acceptItem.tooltip = 'Apply the humanized text';
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
