import * as vscode from 'vscode';
import type { ChangeEntry, DocumentType } from '../types';
import type { AppliedSelectionSummary } from '../review/patch';

let channel: vscode.OutputChannel | undefined;
interface ExplanationSnapshot {
  changes: ChangeEntry[];
  label?: string;
  summary?: AppliedSelectionSummary;
}
let last: ExplanationSnapshot | undefined;

export function getChannel(): vscode.OutputChannel {
  if (!channel) { channel = vscode.window.createOutputChannel('DeSlop: Changes'); }
  return channel;
}

/** Remember the last applied result without forcing a panel open by default. */
export function logChanges(
  changes: ChangeEntry[],
  docType?: DocumentType,
  options: { show?: boolean; summary?: AppliedSelectionSummary } = {},
): void {
  last = { changes: changes.map(change => ({ ...change })), label: docType, summary: options.summary };
  if (options.show) { showChangelog(); }
}

function render(snapshot: ExplanationSnapshot, heading: string): void {
  const ch = getChannel();
  ch.clear();
  ch.appendLine(heading);
  if (snapshot.label) { ch.appendLine(snapshot.label); }
  ch.appendLine('Model-generated explanations for the FULL proposal. Not an exhaustive edit list or a safety guarantee.');
  if (snapshot.summary) {
    const summary = snapshot.summary;
    ch.appendLine(`Applied selection: ${summary.selectedGroups} of ${summary.totalGroups} deterministic groups${summary.fullRewrite ? ' (full rewrite)' : ''}.`);
    ch.appendLine(`Selected group IDs: ${summary.selectedGroupIds.join(', ') || '(none)'}`);
    if (!summary.fullRewrite) {
      ch.appendLine('These explanations may describe excluded changes; they are not a mapping to the applied subset.');
    }
  }
  if (snapshot.changes.length === 0) {
    ch.appendLine('No model explanations were supplied. This does not mean the text was unchanged.');
  } else {
    for (const change of snapshot.changes) { ch.appendLine(`• ${change.pattern} — ${change.action}`); }
  }
  ch.show(true);
}

/** Explicit pre-acceptance action, without overwriting the last applied result. */
export function showReviewChanges(changes: ChangeEntry[], metadataLabel?: string): void {
  render({ changes, label: metadataLabel }, 'Current review — full model proposal');
}

export function showChangelog(): void {
  if (last) { render(last, 'Last applied rewrite'); }
  else {
    const ch = getChannel();
    ch.clear();
    ch.appendLine('No applied rewrite explanations are available in this session.');
    ch.show(true);
  }
}

export function disposeChannel(): void {
  channel?.dispose();
  channel = undefined;
  last = undefined;
}

export function initChannel(context: vscode.ExtensionContext): void {
  context.subscriptions.push({ dispose: disposeChannel });
}
