import * as vscode from 'vscode';
import type { ChangeEntry } from '../types';

let channel: vscode.OutputChannel | undefined;

export function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('DeSlop: Changes');
  }
  return channel;
}

export function logChanges(changes: ChangeEntry[]): void {
  const ch = getChannel();
  if (changes.length === 0) {
    ch.appendLine('[No rule violations found — text already clean]');
  } else {
    changes.forEach((c) => {
      ch.appendLine(`• ${c.pattern} — ${c.action}`);
    });
  }
  ch.appendLine('');
  ch.show(true);
}

export function disposeChannel(): void {
  channel?.dispose();
  channel = undefined;
}

export function initChannel(context: vscode.ExtensionContext): void {
  const ch = getChannel();
  context.subscriptions.push(ch);
}
