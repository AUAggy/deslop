import * as vscode from 'vscode';
import { humanizeSelection, disposeWorkflow, returnToOperation, cancelOperation, copyResult,
  changeDocumentType, changeModel, configurePreferences } from './commands/humanize';
import { resetApiKey, manageConnection, disconnectProvider, registerConnectionHandlers } from './commands/onboarding';
import { initChannel, showChangelog } from './ui/changelog';
import { registerReviewCommands, disposeReview } from './ui/diff';

export function activate(context: vscode.ExtensionContext): void {
  initChannel(context);
  registerReviewCommands(context);
  context.subscriptions.push(registerConnectionHandlers(context));
  const commands: Record<string, () => unknown> = {
    'deslop.humanizeSelection': () => humanizeSelection(context),
    'deslop.resetApiKey': () => resetApiKey(context.secrets),
    'deslop.manageConnection': () => manageConnection(context.secrets),
    'deslop.disconnectProvider': () => disconnectProvider(context.secrets),
    'deslop.showChanges': showChangelog,
    'deslop.returnToOperation': returnToOperation,
    'deslop.cancelOperation': cancelOperation,
    'deslop.copyResult': copyResult,
    'deslop.changeDocumentType': changeDocumentType,
    'deslop.changeModel': changeModel,
    'deslop.configureEditorialPreferences': configurePreferences,
  };
  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
  context.subscriptions.push({ dispose: () => { disposeWorkflow(); disposeReview(); } });
}

export function deactivate(): void {
  disposeWorkflow();
  disposeReview();
}
