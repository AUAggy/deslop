import * as vscode from 'vscode';
import { humanizeSelection } from './commands/humanize';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    'humanizer.humanizeSelection',
    () => humanizeSelection(context)
  );
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // nothing to clean up
}
