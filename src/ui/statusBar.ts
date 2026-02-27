import * as vscode from 'vscode';

let statusItem: vscode.StatusBarItem | undefined;

export function showSpinner(context: vscode.ExtensionContext, label?: string): void {
  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0
    );
    context.subscriptions.push(statusItem);
  }
  const suffix = label ? ` ${label}...` : '...';
  statusItem.text = `$(loading~spin) DeSlopping${suffix}`;
  statusItem.show();
}

export function hideSpinner(): void {
  statusItem?.hide();
}
