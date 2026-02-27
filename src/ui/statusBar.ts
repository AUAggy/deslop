import * as vscode from 'vscode';

let statusItem: vscode.StatusBarItem | undefined;

export function showSpinner(context: vscode.ExtensionContext): void {
  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0
    );
    context.subscriptions.push(statusItem);
  }
  statusItem.text = '$(loading~spin) Humanizing...';
  statusItem.show();
}

export function hideSpinner(): void {
  statusItem?.hide();
}
