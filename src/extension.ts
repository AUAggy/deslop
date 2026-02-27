import * as vscode from 'vscode';
import { humanizeSelection } from './commands/humanize';
import { initChannel } from './ui/changelog';

export function activate(context: vscode.ExtensionContext): void {
  initChannel(context);

  const disposable = vscode.commands.registerCommand(
    'humanizer.humanizeSelection',
    () => humanizeSelection(context)
  );
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // nothing to clean up
}
