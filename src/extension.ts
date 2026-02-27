import * as vscode from 'vscode';
import { humanizeSelection } from './commands/humanize';
import { resetApiKey } from './commands/onboarding';
import { initChannel, showChangelog } from './ui/changelog';

export function activate(context: vscode.ExtensionContext): void {
  initChannel(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deslop.humanizeSelection',
      () => humanizeSelection(context)
    ),
    vscode.commands.registerCommand(
      'deslop.resetApiKey',
      () => resetApiKey(context.secrets)
    ),
    vscode.commands.registerCommand(
      'deslop.showChanges',
      () => showChangelog()
    )
  );
}

export function deactivate(): void {
  // nothing to clean up
}
