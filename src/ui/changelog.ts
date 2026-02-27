import * as vscode from 'vscode';
import type { ChangeEntry, DocumentType } from '../types';

let channel: vscode.OutputChannel | undefined;

export function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('DeSlop: Changes');
  }
  return channel;
}

export function logChanges(changes: ChangeEntry[], docType?: DocumentType): void {
  const ch = getChannel();
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const header = docType ? `[${docType} -- ${timestamp}]` : `[${timestamp}]`;
  ch.appendLine(header);
  if (changes.length === 0) {
    ch.appendLine('[No rule violations found -- text already clean]');
  } else {
    changes.forEach((c) => {
      ch.appendLine(`• ${c.pattern} -- ${c.action}`);
    });
  }
  ch.appendLine('');
  ch.show(true);
}

export function showChangelog(): void {
  getChannel().show(false);
}

export function disposeChannel(): void {
  channel?.dispose();
  channel = undefined;
}

export function initChannel(context: vscode.ExtensionContext): void {
  const ch = getChannel();
  context.subscriptions.push(ch);
}
