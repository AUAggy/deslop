import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { ChangeEntry } from '../types';
import {
  AppliedSelectionSummary, Composition, ReviewPatch, composeReviewPatch, createReviewPatch, validateComposedText,
} from '../review/patch';
import { showReviewChanges } from './changelog';

export interface ReviewMetadata {
  documentType?: string;
  provider?: string;
  model?: string;
  preferences?: { preservePunctuationStyle?: boolean; preserveParagraphListStructure?: boolean };
}
export interface ReviewRequest {
  original: string;
  rewritten: string;
  changes?: ChangeEntry[];
  metadata?: ReviewMetadata;
  operationId?: string;
}
export type ReviewResult = { kind: 'apply'; text: string; summary: AppliedSelectionSummary } | { kind: 'discard' };

type ReviewAction = 'applySelected' | 'acceptAll' | 'discard' | 'return' | 'selectGroups' |
  'selectAll' | 'selectNone' | 'showChanges' | 'showFullProposal' | 'copyResult';
const actions: ReviewAction[] = ['applySelected', 'acceptAll', 'discard', 'return', 'selectGroups',
  'selectAll', 'selectNone', 'showChanges', 'showFullProposal', 'copyResult'];
const scheme = 'deslop-review';
const contents = new Map<string, string>();
let changed: vscode.EventEmitter<vscode.Uri> | undefined;
let active: ReviewSession | undefined;
let registered = false;

/** Register once at activation, never transiently per review. */
export function registerReviewCommands(context: vscode.ExtensionContext): void {
  if (registered) { return; }
  registered = true;
  changed = new vscode.EventEmitter<vscode.Uri>();
  context.subscriptions.push(changed, vscode.workspace.registerTextDocumentContentProvider(scheme, {
    onDidChange: changed.event,
    provideTextDocumentContent: uri => contents.get(uri.toString()) ?? '',
  }));
  for (const action of actions) {
    context.subscriptions.push(vscode.commands.registerCommand(`deslop.review.${action}`, async (target?: unknown) => {
      const session = active;
      if (!session || !session.matchesTarget(target)) { return; }
      // Palette actions outside this review first return to it; no unrelated
      // editor can become an implicit apply target.
      if (['applySelected', 'acceptAll', 'discard'].includes(action) && !session.isActiveTab()) {
        await session.open();
        return;
      }
      try { await session.command(action); }
      catch { void vscode.window.showWarningMessage('The review action could not complete. Return to Review, copy the completed result, or discard. Source text was not changed.'); }
    }));
  }
  context.subscriptions.push({ dispose: () => {
    disposeReview();
    contents.clear();
    changed = undefined;
    registered = false;
  } });
}

export async function showReview(request: ReviewRequest): Promise<ReviewResult> {
  if (!registered) { throw new Error('Register review commands before opening a review'); }
  if (active) { throw new Error('A DeSlop review is already active'); }
  if (validateComposedText(request.original, request.rewritten).length) {
    throw new Error('The full proposal failed protected-content or output-integrity validation');
  }
  const session = new ReviewSession(request);
  active = session;
  try {
    session.start();
    await session.open();
  } catch (error) {
    session.finish({ kind: 'discard' });
    throw error;
  }
  return session.result;
}

export async function returnToReview(): Promise<void> {
  try { await active?.open(); }
  catch { void vscode.window.showWarningMessage('Review could not be reopened. The completed result is still available to copy or discard.'); }
}
export function cancelReview(): void { active?.finish({ kind: 'discard' }); }
export function disposeReview(): void { cancelReview(); }

/** Legacy whole-rewrite adapter. New workflow MUST consume showReview's text. */
export async function showDiffAndPrompt(original: string, rewritten: string): Promise<boolean> {
  const result = await showReview({ original, rewritten });
  // Never claim partial text was accepted to a caller that can only apply full text.
  return result.kind === 'apply' && result.text === rewritten;
}

class ReviewSession {
  readonly id = crypto.randomBytes(16).toString('hex');
  readonly originalUri = vscode.Uri.parse(`${scheme}:/${this.id}/original-read-only.txt`);
  readonly composedUri = vscode.Uri.parse(`${scheme}:/${this.id}/selected-read-only.txt`);
  readonly fullUri = vscode.Uri.parse(`${scheme}:/${this.id}/full-proposal-read-only.txt`);
  readonly patch: ReviewPatch;
  readonly result: Promise<ReviewResult>;
  private resolve!: (result: ReviewResult) => void;
  private composition: Composition;
  private selected: Set<string>;
  private disposed = false;
  private opened = false;
  private readonly subscriptions: vscode.Disposable[] = [];
  private picker: vscode.QuickPick<vscode.QuickPickItem & { id: string }> | undefined;
  private status: vscode.StatusBarItem[] = [];
  private restoring = new Map<string, string>();

  private readonly request: ReviewRequest;

  constructor(request: ReviewRequest) {
    this.request = {
      ...request,
      changes: request.changes?.map(change => ({ ...change })),
      metadata: request.metadata ? {
        ...request.metadata, preferences: request.metadata.preferences ? { ...request.metadata.preferences } : undefined,
      } : undefined,
    };
    this.patch = createReviewPatch(request.original, request.rewritten);
    this.selected = new Set(this.patch.groups.map(g => g.id));
    this.composition = composeReviewPatch(this.patch, this.selected);
    this.result = new Promise(resolve => { this.resolve = resolve; });
  }

  start(): void {
    contents.set(this.originalUri.toString(), this.request.original);
    contents.set(this.composedUri.toString(), this.composition.text);
    contents.set(this.fullUri.toString(), this.request.rewritten);
    for (const [text, action] of [
      ['$(check) Apply selected', 'applySelected'], ['$(list-selection) Change groups', 'selectGroups'],
      ['$(info) Show changes', 'showChanges'], ['$(x) Discard', 'discard'],
    ] as const) {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
      item.text = text;
      item.command = { command: `deslop.review.${action}`, title: text, arguments: [this.id] };
      const coarse = this.patch.groups.filter(group => group.reason?.includes('Coarse'));
      item.tooltip = coarse.length
        ? `${coarse.length} coarse local comparison/ambiguous blocks. Inspect their grouping reasons in Change Groups.`
        : 'DeSlop: read-only review; text groups are not a guarantee of semantic independence. Source is unchanged until application';
      this.status.push(item);
      this.subscriptions.push(item);
    }
    // Virtual documents are read-only in the editor UI, but other extensions can
    // still submit WorkspaceEdits. Restore our authoritative composed preview.
    this.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
      const expected = contents.get(event.document.uri.toString());
      if (!this.disposed && expected !== undefined) {
        if (event.document.getText() === expected) { this.restoring.delete(event.document.uri.toString()); }
        else { this.refreshPreview(event.document); }
      }
    }));
    this.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
      // Ownership policy: closing any composed review view discards the session,
      // including duplicate views in other groups. No source is changed.
      if (event.closed.some(tab => this.isComposedTab(tab))) {
        this.finish({ kind: 'discard' });
      } else { this.updateContext(); }
    }), vscode.window.tabGroups.onDidChangeTabGroups(() => {
      if (this.opened && !vscode.window.tabGroups.all.some(group => group.tabs.some(tab => this.isComposedTab(tab)))) {
        this.finish({ kind: 'discard' });
      } else { this.updateContext(); }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()));
    this.updateSelectionLabel();
    this.updateContext();
  }

  private updateSelectionLabel(): void {
    if (this.status[0]) { this.status[0].text = `$(check) Apply selected (${this.selected.size}/${this.patch.groups.length} groups)`; }
  }

  private isComposedTab(tab: vscode.Tab): boolean {
    return tab.input instanceof vscode.TabInputTextDiff &&
      tab.input.original.toString() === this.originalUri.toString() &&
      tab.input.modified.toString() === this.composedUri.toString();
  }

  isActiveTab(): boolean {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    return !!tab && this.isComposedTab(tab) && !this.disposed;
  }

  matchesTarget(target: unknown): boolean {
    if (target === undefined) { return true; }
    if (typeof target === 'string') { return target === this.id; }
    if (target instanceof vscode.Uri) {
      return [this.originalUri, this.composedUri, this.fullUri].some(uri => uri.toString() === target.toString());
    }
    return false;
  }

  private updateContext(): void {
    const visible = this.isActiveTab();
    void vscode.commands.executeCommand('setContext', 'deslop.reviewAvailable', !this.disposed);
    void vscode.commands.executeCommand('setContext', 'deslop.reviewActive', visible);
    for (const item of this.status) { if (visible) { item.show(); } else { item.hide(); } }
  }

  async open(full = false): Promise<void> {
    if (this.disposed) { return; }
    await vscode.commands.executeCommand('vscode.diff', this.originalUri, full ? this.fullUri : this.composedUri,
      `DeSlop: ${full ? 'Full proposal' : 'Selected changes'} (read-only; ${this.patch.groups.length} groups${this.patch.groups.some(group => group.reason?.includes('Coarse')) ? ', includes coarse local blocks' : ''}) — ${metadataLabel(this.request.metadata)}`,
      { preview: false });
    if (this.disposed) { await this.closeTabs(); } else { this.opened = true; this.updateContext(); }
  }

  private setSelection(ids: Iterable<string>): boolean {
    if (this.disposed) { return false; }
    const selected = new Set(ids);
    const next = composeReviewPatch(this.patch, selected);
    if (next.issues.length) {
      void vscode.window.showWarningMessage(`Cannot compose these groups: ${next.issues.join('; ')} Select related groups together or use the full rewrite. The preview was not changed.`);
      return false;
    }
    this.selected = selected;
    this.composition = next;
    this.updateSelectionLabel();
    contents.set(this.composedUri.toString(), next.text);
    changed?.fire(this.composedUri);
    return true;
  }

  private refreshPreview(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    const expected = contents.get(uri);
    // A native model can normalise mixed EOLs. Refresh once per expected text,
    // then fail closed rather than creating an endless refresh/change loop.
    if (expected !== undefined && this.restoring.get(uri) !== expected) {
      this.restoring.set(uri, expected);
      changed?.fire(document.uri);
    }
  }

  private exactPreview(text: string): boolean {
    const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === this.composedUri.toString());
    if (document?.getText() === text) { return true; }
    if (document) { this.refreshPreview(document); }
    void vscode.window.showWarningMessage('The native preview is not yet identical to the selected result. Inspect the refreshed review and try again. If it remains unavailable (for example, mixed line endings), copy the completed result or discard; nothing was applied.');
    return false;
  }

  async command(action: ReviewAction): Promise<void> {
    if (this.disposed) { return; }
    if (action !== 'discard') {
      const altered = vscode.workspace.textDocuments.filter(document => {
        const expected = contents.get(document.uri.toString());
        return expected !== undefined && document.getText() !== expected;
      });
      if (altered.length) {
        for (const document of altered) { this.refreshPreview(document); }
        void vscode.window.showWarningMessage('The read-only review was changed externally. Its preview is being restored; inspect it before choosing an action.');
        return;
      }
    }
    switch (action) {
      case 'applySelected':
      case 'acceptAll': {
        if (action === 'acceptAll' && !this.setSelection(this.patch.groups.map(g => g.id))) { return; }
        // Re-run validation immediately before handing exact text to workflow.
        const final = composeReviewPatch(this.patch, this.selected);
        if (final.issues.length) {
          void vscode.window.showWarningMessage(`Cannot apply this selection: ${final.issues.join('; ')}`);
          return;
        }
        if (!this.exactPreview(final.text)) { return; }
        this.finish({ kind: 'apply', text: final.text, summary: final.summary });
        return;
      }
      case 'discard': this.finish({ kind: 'discard' }); return;
      case 'return': await this.open(); return;
      case 'selectAll': this.setSelection(this.patch.groups.map(g => g.id)); this.syncPicker(); return;
      case 'selectNone': this.setSelection([]); this.syncPicker(); return;
      case 'selectGroups': this.showGroups(); return;
      case 'showChanges': showReviewChanges(this.request.changes ?? [], metadataLabel(this.request.metadata)); return;
      case 'showFullProposal': await this.open(true); return;
      case 'copyResult': await vscode.env.clipboard.writeText(this.composition.text); return;
    }
  }

  private syncPicker(): void {
    if (this.picker) { this.picker.selectedItems = this.picker.items.filter(item => this.selected.has(item.id)); }
  }

  private showGroups(): void {
    if (this.picker) { this.picker.show(); return; }
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { id: string }>();
    this.picker = picker;
    picker.canSelectMany = true;
    picker.title = 'DeSlop: include/exclude change groups (Space to toggle, Enter to return)';
    picker.placeholder = 'Preview updates immediately. Meaning still requires your review; explanations describe the full proposal.';
    picker.matchOnDetail = true;
    const all = { iconPath: new vscode.ThemeIcon('check-all'), tooltip: 'Select all groups' };
    const none = { iconPath: new vscode.ThemeIcon('clear-all'), tooltip: 'Clear all groups' };
    picker.buttons = [all, none];
    picker.items = this.patch.groups.map((group, i) => ({
      id: group.id,
      label: `Change ${i + 1} — original line ${1 + this.request.original.slice(0, group.start).split('\n').length - 1}`,
      description: group.reason ?? 'Text change group',
      detail: `Before: ${snippet(group.before, group.after)} → After: ${snippet(group.after, group.before)}`,
      buttons: [{ iconPath: new vscode.ThemeIcon('go-to-file'), tooltip: 'Reveal this change in the selected preview' }],
    }));
    this.syncPicker();
    const listeners = [
      picker.onDidChangeSelection(items => {
        if (!this.setSelection(items.map(item => item.id))) { this.syncPicker(); }
      }),
      picker.onDidTriggerButton(button => {
        this.setSelection(button === all ? this.patch.groups.map(g => g.id) : []);
        this.syncPicker();
      }),
      picker.onDidTriggerItemButton(event => {
        const id = event.item.id;
        picker.hide();
        void this.revealGroup(id).catch(() => {
          void vscode.window.showWarningMessage('This change could not be revealed. Use Return to Review and inspect the native diff; source text was not changed.');
        });
      }),
      picker.onDidAccept(() => { picker.hide(); void this.open().catch(() => {
        void vscode.window.showWarningMessage('Review could not be reopened. Use Return to Review, copy the completed result, or discard.');
      }); }),
      picker.onDidHide(() => {
        for (const listener of listeners) { listener.dispose(); }
        picker.dispose();
        if (this.picker === picker) { this.picker = undefined; }
      }),
    ];
    this.subscriptions.push(...listeners);
    picker.show();
  }

  private async revealGroup(id: string): Promise<void> {
    const group = this.patch.groups.find(candidate => candidate.id === id);
    if (!group || this.disposed) { return; }
    await this.open();
    if (this.disposed || !this.exactPreview(this.composition.text)) { return; }
    const editor = vscode.window.visibleTextEditors.find(candidate => candidate.document.uri.toString() === this.composedUri.toString());
    if (!editor) {
      void vscode.window.showInformationMessage('The selected native diff is open. Use its change navigation to inspect this group.');
      return;
    }
    let offset = group.start;
    for (const previous of this.patch.groups) {
      if (previous.id === id) { break; }
      if (this.selected.has(previous.id)) { offset += previous.after.length - previous.before.length; }
    }
    const length = this.selected.has(id) ? group.after.length : group.before.length;
    editor.revealRange(new vscode.Range(editor.document.positionAt(offset), editor.document.positionAt(offset + length)), vscode.TextEditorRevealType.InCenter);
  }

  finish(result: ReviewResult): void {
    if (this.disposed) { return; }
    this.disposed = true;
    if (active === this) { active = undefined; }
    this.picker?.hide();
    this.picker?.dispose();
    this.picker = undefined;
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.status = [];
    for (const uri of [this.originalUri, this.composedUri, this.fullUri]) { contents.delete(uri.toString()); }
    this.updateContext();
    this.resolve(result);
    void this.closeTabs();
  }

  private async closeTabs(): Promise<void> {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
      tab.input instanceof vscode.TabInputTextDiff && tab.input.original.toString() === this.originalUri.toString());
    if (tabs.length) {
      try {
        if (await vscode.window.tabGroups.close(tabs)) { return; }
      } catch { /* The session is settled even when the host cannot close its tabs. */ }
      void vscode.window.showWarningMessage('The review session ended, but the editor could not close every preview tab. Close any remaining read-only DeSlop tabs manually.');
    }
  }
}

function snippet(text: string, other: string): string {
  if (!text) { return '(empty)'; }
  const points = Array.from(text);
  const comparison = Array.from(other);
  let prefix = 0;
  while (prefix < Math.min(points.length, comparison.length) && points[prefix] === comparison[prefix]) { prefix++; }
  const start = Math.max(0, prefix - 60);
  const excerpt = points.slice(start, start + 220).join('').replace(/\r/g, '\\r').replace(/\n/g, ' ↵ ');
  return (start ? '… ' : '') + excerpt + (start + 220 < points.length ? '… (inspect diff for complete text)' : '');
}

function metadataLabel(metadata?: ReviewMetadata): string {
  const preferences = metadata?.preferences;
  const prefs = preferences ? `punctuation ${preferences.preservePunctuationStyle ? 'preserve' : 'default'}, structure ${preferences.preserveParagraphListStructure ? 'preserve' : 'default'}` : '';
  return [metadata?.documentType, metadata?.provider, metadata?.model, prefs].filter(Boolean).join(' · ') || 'Review rewrite';
}
