import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Opens a native VS Code diff view between original and rewritten text,
 * then shows an Accept/Discard notification.
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

  let choice: string | undefined;
  try {
    const origUri = vscode.Uri.file(origFile);
    const rewrittenUri = vscode.Uri.file(rewrittenFile);

    await vscode.commands.executeCommand(
      'vscode.diff',
      origUri,
      rewrittenUri,
      'Humanizer: Review Changes'
    );

    choice = await vscode.window.showInformationMessage(
      'Accept the rewrite?',
      { modal: false },
      'Accept',
      'Discard'
    );

    // Close the diff tab (best-effort)
    const tabsToClose = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((tab) => {
        if (tab.input instanceof vscode.TabInputTextDiff) {
          const diffInput = tab.input as vscode.TabInputTextDiff;
          return (
            diffInput.original.fsPath === origFile ||
            diffInput.modified.fsPath === rewrittenFile
          );
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
