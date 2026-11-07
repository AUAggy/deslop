import * as vscode from 'vscode';
import { ensureApiKey, promptAndSaveKey, manageConnection } from './onboarding';
import { callHumanize, captureRequestOptions, isSelectionTooLong } from '../api/providers';
import { classifyProviderError } from '../api/errors';
import type { AppliedSelectionSummary } from '../review/patch';
import { showReview, returnToReview, cancelReview } from '../ui/diff';
import { logChanges } from '../ui/changelog';
import { isProseSelection, isCodeCommentSelection } from '../util/isProseSelection';
import { verifyProtectedRegions, stripInvisible } from '../util/postCheck';
import { resolveDocumentType, orderedDocumentTypes } from '../editorial/documentType';
import { readEditorialPreferences, readRememberDocumentType, configureEditorialPreferences } from '../editorial/settings';
import { buildPreferenceInstructions, describeEditorialPreferences } from '../editorial/preferences';
import { OperationSlot, RewriteOperation, sourceIsFresh } from './operation';
import type { DocumentType, HumanizeResponse } from '../types';

interface RequestSnapshot {
  readonly document: vscode.TextDocument;
  readonly range: vscode.Range;
  readonly text: string;
  readonly version: number;
  readonly documentType: DocumentType;
  readonly provider: 'openrouter' | 'venice';
  readonly model: string;
  readonly preferences: ReturnType<typeof readEditorialPreferences>;
  readonly preferenceInstructions: string;
  readonly autoAccept: boolean;
  readonly showChangeLog: boolean;
}

type Operation = RewriteOperation<RequestSnapshot>;
const operations = new OperationSlot<RequestSnapshot>();
let contextForCommands: vscode.ExtensionContext | undefined;
let completed: HumanizeResponse | undefined;
let completedSnapshot: Readonly<RequestSnapshot> | undefined;
const MAX_ATTEMPTS = 3;

export function approximateWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function readTrustedBoolean(config: vscode.WorkspaceConfiguration, key: string, fallback: boolean): boolean {
  const inspected = config.inspect<boolean>(key);
  if (typeof inspected?.globalValue === 'boolean') { return inspected.globalValue; }
  if (typeof inspected?.defaultValue === 'boolean') { return inspected.defaultValue; }
  return fallback;
}

function fresh(s: Readonly<RequestSnapshot>): boolean {
  return sourceIsFresh(s, s.document, () => s.document.getText(s.range));
}

function finish(op: Operation, state: 'applied' | 'discarded' | 'cancelled'): void {
  if (!operations.owns(op)) { return; }
  op.finish(state);
  completed = undefined;
  completedSnapshot = undefined;
  void vscode.commands.executeCommand('setContext', 'deslop.operationAvailable', false);
}

export function disposeWorkflow(): void {
  operations.dispose();
  cancelReview();
  completed = undefined;
  completedSnapshot = undefined;
  contextForCommands = undefined;
  void vscode.commands.executeCommand('setContext', 'deslop.operationAvailable', false);
}

async function pickType(context: vscode.ExtensionContext, remember = true, owns = () => true): Promise<DocumentType | undefined> {
  const items = orderedDocumentTypes(context.globalState.get('deslop.lastDocType')).map(value => ({ label: value, value }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select document type' });
  if (!picked || !owns()) { return undefined; }
  // Persist only an explicit choice, never an inference or a cancelled picker.
  if (remember) { await context.globalState.update('deslop.lastDocType', picked.value); }
  return picked.value;
}

export async function humanizeSelection(context: vscode.ExtensionContext): Promise<void> {
  const op = operations.acquire();
  if (!op) {
    const active = operations.active;
    const action = await vscode.window.showInformationMessage('A DeSlop operation is already active.', 'Return to Operation', 'Cancel Operation');
    if (operations.active !== active || !active || active.terminal) { return; }
    if (action === 'Return to Operation') { await returnToOperation(); }
    if (action === 'Cancel Operation') { cancelOperation(); }
    return;
  }
  contextForCommands = context;
  completed = undefined;
  void vscode.commands.executeCommand('setContext', 'deslop.operationAvailable', true);
  try {
    const token = op.begin('preparing');
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showErrorMessage('Open a file and select the text you want to humanize.');
      finish(op, 'cancelled');
      return;
    }
    const document = editor.document;
    const range = new vscode.Selection(editor.selection.start, editor.selection.end);
    const text = document.getText(range);
    const version = document.version;
    const config = vscode.workspace.getConfiguration('deslop');
    const { provider, model } = captureRequestOptions();
    const preferences = Object.freeze({ ...readEditorialPreferences() });
    const consent = {
      autoAccept: readTrustedBoolean(config, 'autoAccept', false),
      showChangeLog: readTrustedBoolean(config, 'showChangeLog', false),
    };
    const defaultDocumentType = config.get('defaultDocumentType');
    const rememberDocumentType = readRememberDocumentType();
    if (isSelectionTooLong(text)) {
      void vscode.window.showErrorMessage(`Selection is ~${approximateWordCount(text).toLocaleString()} words. Limit is ~3,000. Select a shorter passage.`);
      finish(op, 'cancelled');
      return;
    }
    if (!await isProseSelection(document, range)) {
      if (!op.owns(token)) { return; }
      void vscode.window.showErrorMessage('DeSlop rewrites prose, not code. Select a comment or documentation block.');
      finish(op, 'cancelled');
      return;
    }
    if (!op.owns(token)) { return; }
    const isCodeComment = await isCodeCommentSelection(document, range);
    if (!op.owns(token)) { return; }
    const resolution = resolveDocumentType({
      defaultDocumentType, fileName: document.fileName, languageId: document.languageId,
      isCodeComment, rememberDocumentType, lastDocumentType: context.globalState.get('deslop.lastDocType'),
    });
    const documentType = resolution.type ?? await pickType(context, true, () => op.owns(token));
    if (!op.owns(token)) { return; }
    if (!documentType) { finish(op, 'cancelled'); return; }
    op.capture({ document, range, text, version, documentType, provider, model,
      preferences, preferenceInstructions: buildPreferenceInstructions(preferences), ...consent });
    await requestRewrite(op, context);
  } catch {
    if (operations.owns(op)) {
      void vscode.window.showErrorMessage('DeSlop could not prepare this rewrite. Source text was not changed.');
      finish(op, 'cancelled');
    }
  }
}

async function requestRewrite(op: Operation, context: vscode.ExtensionContext): Promise<void> {
  const s = op.snapshot!;
  const previous = completed;
  const previousSnapshot = completedSnapshot;
  const previousText = op.result;
  const restorePrevious = () => {
    if (previous && previousSnapshot) {
      completed = previous;
      completedSnapshot = previousSnapshot;
      op.result = previousText;
      op.capture(previousSnapshot);
    }
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS && operations.owns(op); attempt++) {
    const token = op.begin('preparing');
    if (!fresh(s)) { restorePrevious(); await recover(op, 'The source changed or closed. A new request will not be sent.'); return; }
    let key: string | undefined;
    try { key = await ensureApiKey(context.secrets, s.provider, op.controller.signal); }
    catch {
      if (op.owns(token)) { restorePrevious(); await recover(op, 'Connection setup failed. No rewrite request was sent.'); }
      return;
    }
    if (!op.owns(token)) { return; }
    if (!key) {
      if (previous) { restorePrevious(); await recover(op, 'Setup cancelled. Your previous result is still available.'); }
      else { finish(op, 'cancelled'); }
      return;
    }
    if (!fresh(s)) { restorePrevious(); await recover(op, 'The source changed or closed during setup.'); return; }
    const requestToken = op.begin('requesting');
    try {
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `DeSlop: ${s.documentType} via ${s.provider} / ${s.model} — ${describeEditorialPreferences(s.preferences)}`,
        cancellable: true,
      }, async (progress, cancellation) => {
        progress.report({ message: 'Cancellation may not prevent provider usage charges.' });
        const listener = cancellation.onCancellationRequested(() => {
          if (op.owns(requestToken)) { cancelOperation(); }
        });
        try {
          return await callHumanize(key, s.text, s.documentType, {
            provider: s.provider, model: s.model, signal: op.controller.signal,
            preferenceInstructions: s.preferenceInstructions,
          });
        } finally { listener.dispose(); }
      });
      if (!op.owns(requestToken)) { return; }
      completed = result;
      completedSnapshot = s;
      op.result = result.rewritten;
      if (result.rewritten === s.text) {
        void vscode.window.showInformationMessage('No changes needed.');
        finish(op, 'discarded');
        return;
      }
      if (!fresh(s)) { await recover(op, 'The source changed or closed. Your completed rewrite is available to copy.'); return; }
      if (s.autoAccept) { await applyResult(op, result.rewritten); }
      else { await reviewResult(op); }
      return;
    } catch (error: unknown) {
      if (!op.owns(requestToken)) { return; }
      const failure = classifyProviderError(error);
      // Never display raw errors: they may contain selected prose or credentials.
      const failureToken = op.begin('recoverable');
      const canRetry = attempt + 1 < MAX_ATTEMPTS;
      const actions: string[] = canRetry ? ['Retry'] : [];
      if (canRetry && failure.category === 'authentication') { actions.push('Replace Key'); }
      if (canRetry && failure.category === 'model') { actions.push('Change Model'); }
      if (canRetry && ['credit', 'permission', 'unknown'].includes(failure.category)) { actions.push('Manage Connection'); }
      if (op.result) { actions.push('Keep Result'); }
      actions.push('Discard');
      const action = await vscode.window.showErrorMessage(
        `${s.provider} / ${s.model}: ${failure.message} ${attempt + 1 < MAX_ATTEMPTS ? 'Retry retains the captured source and request choices.' : 'Retry limit reached; no further request will be sent.'}`, ...actions);
      if (!op.owns(failureToken)) { return; }
      if (action === 'Retry') { continue; }
      if (action === 'Replace Key' || action === 'Manage Connection') {
        try {
          if (action === 'Replace Key') { await promptAndSaveKey(context.secrets, s.provider, op.controller.signal); }
          else { await manageConnection(context.secrets, s.provider); }
        } catch { /* A failed connection action must not discard an existing completed result. */ }
        if (!op.owns(failureToken)) { return; }
        // Replacement does not silently incur another request.
        const retry = await vscode.window.showInformationMessage('Retry the captured request? Provider usage charges may apply.', 'Retry');
        if (!op.owns(failureToken)) { return; }
        if (retry === 'Retry') { continue; }
      }
      if (action === 'Change Model') { restorePrevious(); await changeModel(); return; }
      restorePrevious();
      if (op.result && action !== 'Discard') { await recover(op, 'The completed result remains available.'); }
      else { finish(op, 'discarded'); }
      return;
    }
  }
}

async function reviewResult(op: Operation): Promise<void> {
  if (!operations.owns(op) || !completed || !op.snapshot) { return; }
  const s = op.snapshot;
  const token = op.begin('reviewing');
  try {
    const result = await showReview({ original: s.text, rewritten: completed.rewritten,
      changes: completed.changes, metadata: { documentType: s.documentType, provider: s.provider,
        model: s.model, preferences: s.preferences } });
    if (!op.owns(token)) { return; }
    if (result.kind === 'discard') { finish(op, 'discarded'); return; }
    op.result = result.text;
    await applyResult(op, result.text, result.summary);
  } catch {
    if (op.owns(token)) { await recover(op, 'Review could not be opened. Your result is still available.'); }
  }
}

async function applyResult(op: Operation, text: string, summary?: AppliedSelectionSummary): Promise<void> {
  if (!operations.owns(op) || !op.snapshot) { return; }
  const s = op.snapshot;
  if (text === s.text) { finish(op, 'discarded'); return; }
  const protectedIssues = verifyProtectedRegions(s.text, text);
  if (protectedIssues.length || stripInvisible(text).text !== text) {
    await recover(op, 'This selection failed output-integrity checks. It cannot be applied.');
    return;
  }
  if (!fresh(s)) { await recover(op, 'The source changed or closed. Application was blocked.'); return; }
  const token = op.begin('applying');
  let applied = false;
  try {
    // A captured TextEditor can be disposed when a different file replaces its
    // tab. Reveal ONLY the captured source, then recheck freshness after the await.
    const editor = await vscode.window.showTextDocument(s.document, { preview: false });
    if (!op.owns(token) || !fresh(s)) { throw new Error('Source changed'); }
    // TextEditor.edit checks version and provides one logical undo step. No await
    // occurs between the final freshness check and submission of the edit.
    applied = await editor.edit(builder => {
      if (!fresh(s)) { throw new Error('Source changed'); }
      builder.replace(s.range, text);
    }, { undoStopBefore: true, undoStopAfter: true });
  } catch { /* Recover without exposing source/provider payloads. */ }
  if (!op.owns(token)) { return; }
  if (!applied) { await recover(op, 'The edit could not be applied. Your result is still available.'); return; }
  // Terminal state first: once the editor confirmed the edit, optional explanation
  // storage must not own correctness or keep the operation in 'applying'. finish()
  // clears the completed result, so capture what the changelog needs beforehand.
  const appliedResult = completed;
  finish(op, 'applied');
  try {
    if (appliedResult) { logChanges(appliedResult.changes, s.documentType, { show: s.showChangeLog, summary }); }
  } catch {
    void vscode.window.showWarningMessage('Rewrite applied, but the change log could not be updated. Undo restores the original selection.');
    return;
  }
  void vscode.window.showInformationMessage('Rewrite applied. Undo restores the original selection.');
}

async function recover(op: Operation, message: string): Promise<void> {
  if (!operations.owns(op)) { return; }
  const token = op.begin('recoverable');
  const actions = op.result ? ['Copy Result', 'Review Full Proposal', 'Discard'] : ['Discard'];
  const action = await vscode.window.showWarningMessage(message, ...actions);
  if (!op.owns(token)) { return; }
  if (action === 'Copy Result') { await copyResult(); }
  if (action === 'Review Full Proposal') { await reviewResult(op); }
  if (action === 'Discard') { finish(op, 'discarded'); }
  // Dismissal intentionally retains recovery until an explicit action or reload.
}

export async function returnToOperation(): Promise<void> {
  const op = operations.active;
  if (!op || op.terminal) { return; }
  if (op.state === 'reviewing') { await returnToReview(); }
  else if (op.state === 'recoverable') { await recover(op, 'DeSlop has a pending operation. Changed or closed source cannot be overwritten.'); }
  else { void vscode.window.showInformationMessage(`DeSlop is ${op.state}. Use Cancel Operation to stop. Cancellation may still incur provider usage charges.`); }
}

export function cancelOperation(): void {
  const op = operations.active;
  if (!op || op.terminal) { return; }
  // An editor edit cannot be aborted once submitted; await its boolean outcome.
  if (op.state === 'applying') { return; }
  finish(op, 'cancelled');
  cancelReview();
}

export async function copyResult(): Promise<void> {
  const op = operations.active;
  if (op && !op.terminal && op.result !== undefined) { await vscode.env.clipboard.writeText(op.result); }
}

async function regenerate(revision: Partial<RequestSnapshot>): Promise<void> {
  const op = operations.active;
  const context = contextForCommands;
  if (!op || !context || !op.snapshot || !['reviewing', 'recoverable'].includes(op.state)) { return; }
  const token = op.token;
  const consent = await vscode.window.showWarningMessage('Regenerate from the captured source with new choices? This sends another potentially billable request. The previous result remains available if the request fails.', 'Regenerate');
  if (!op.owns(token) || consent !== 'Regenerate') { return; }
  op.begin('preparing'); // invalidate the awaiting review before resolving it
  cancelReview();
  op.capture({ ...op.snapshot, ...revision, autoAccept: false });
  await requestRewrite(op, context);
}

export async function changeDocumentType(): Promise<void> {
  const op = operations.active;
  if (!op || !op.snapshot || !contextForCommands || !['reviewing', 'recoverable'].includes(op.state)) { return; }
  const snapshot = op.snapshot;
  const type = await pickType(contextForCommands, false);
  if (operations.owns(op) && op.snapshot === snapshot && type && type !== snapshot.documentType) {
    await regenerate({ documentType: type });
  }
}

export async function changeModel(): Promise<void> {
  const op = operations.active;
  if (!op?.snapshot || !['reviewing', 'recoverable'].includes(op.state)) { return; }
  const snapshot = op.snapshot;
  const model = await vscode.window.showInputBox({ prompt: `Model ID for ${snapshot.provider}; applies to this operation only`, value: snapshot.model,
    validateInput: value => value.trim() && value.length <= 200 && !/[\r\n]/.test(value) ? undefined : 'Enter a model ID (maximum 200 characters).' });
  if (operations.owns(op) && op.snapshot === snapshot && model && model.trim() !== snapshot.model) { await regenerate({ model: model.trim() }); }
}

export async function configurePreferences(): Promise<void> {
  const op = operations.active;
  const snapshot = op?.snapshot;
  if (!await configureEditorialPreferences()) { return; }
  if (op && operations.owns(op) && op.snapshot === snapshot && ['reviewing', 'recoverable'].includes(op.state)) {
    const preferences = Object.freeze({ ...readEditorialPreferences() });
    await regenerate({ preferences, preferenceInstructions: buildPreferenceInstructions(preferences) });
  }
}
