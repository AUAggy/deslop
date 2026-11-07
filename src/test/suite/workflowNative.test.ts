import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as providers from '../../api/providers';
import * as onboarding from '../../commands/onboarding';
import * as review from '../../ui/diff';
import { humanizeSelection, cancelOperation, disposeWorkflow } from '../../commands/humanize';

/** Real editor APIs, synthetic disk fixtures, and strictly mocked credentials/inference.
 * These tests call compiled workflow modules directly, not contributed palette commands.
 */
suite('Native editor workflow — no provider requests', () => {
  const providerBoundary = providers as { callHumanize: typeof providers.callHumanize };
  const onboardingBoundary = onboarding as { ensureApiKey: typeof onboarding.ensureApiKey };
  const reviewBoundary = review as { showReview: typeof review.showReview };
  const subscriptions: vscode.Disposable[] = [];
  const documents: vscode.TextDocument[] = [];
  const source = 'Padded prose.\nAn unchanged anchor.\nMore padded prose.\n';
  const proposal = 'Clear prose.\nAn unchanged anchor.\nClearer prose.\n';
  const original = {
    request: providers.callHumanize, key: onboarding.ensureApiKey, review: review.showReview,
    info: vscode.window.showInformationMessage, warning: vscode.window.showWarningMessage,
    error: vscode.window.showErrorMessage,
  };
  let directory: string;
  let previousDefault: unknown;
  let previousAutoAccept: unknown;
  let previousLog: unknown;
  let requestCount = 0;

  async function openSource(name = 'README.md'): Promise<vscode.TextEditor> {
    const uri = vscode.Uri.file(path.join(directory, name));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
    const document = await vscode.workspace.openTextDocument(uri);
    documents.push(document);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(document.positionAt(0), document.positionAt(source.length));
    return editor;
  }

  const apply = (text: string): ReturnType<typeof review.showReview> => Promise.resolve({
    kind: 'apply', text,
    summary: { selectedGroupIds: ['group-1'], totalGroups: 2, selectedGroups: 1, fullRewrite: false },
  });

  suiteSetup(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'deslop-native-fixtures-'));
    const config = vscode.workspace.getConfiguration('deslop');
    previousDefault = config.inspect('defaultDocumentType')?.globalValue;
    previousAutoAccept = config.inspect('autoAccept')?.globalValue;
    previousLog = config.inspect('showChangeLog')?.globalValue;
    await config.update('defaultDocumentType', 'README', vscode.ConfigurationTarget.Global);
    await config.update('autoAccept', false, vscode.ConfigurationTarget.Global);
    await config.update('showChangeLog', false, vscode.ConfigurationTarget.Global);
    // Replacing CommonJS export boundaries keeps production code free of test hooks.
    providerBoundary.callHumanize = async () => {
      requestCount++;
      return { rewritten: proposal, changes: [] };
    };
    onboardingBoundary.ensureApiKey = async () => 'synthetic-not-a-credential';
    vscode.window.showInformationMessage = (async () => undefined) as typeof original.info;
    vscode.window.showWarningMessage = (async () => undefined) as typeof original.warning;
    vscode.window.showErrorMessage = (async () => undefined) as typeof original.error;
    review.registerReviewCommands({ subscriptions } as unknown as vscode.ExtensionContext);
  });

  teardown(async () => {
    cancelOperation();
    review.cancelReview();
    reviewBoundary.showReview = original.review;
    // Save ONLY synthetic fixture sources so closing their tabs cannot prompt.
    for (const document of documents) {
      if (!document.isClosed && document.isDirty) { await document.save(); }
    }
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs));
  });

  suiteTeardown(async () => {
    disposeWorkflow();
    for (const subscription of subscriptions.reverse()) { subscription.dispose(); }
    providerBoundary.callHumanize = original.request;
    onboardingBoundary.ensureApiKey = original.key;
    reviewBoundary.showReview = original.review;
    vscode.window.showInformationMessage = original.info;
    vscode.window.showWarningMessage = original.warning;
    vscode.window.showErrorMessage = original.error;
    const config = vscode.workspace.getConfiguration('deslop');
    await config.update('defaultDocumentType', previousDefault, vscode.ConfigurationTarget.Global);
    await config.update('autoAccept', previousAutoAccept, vscode.ConfigurationTarget.Global);
    await config.update('showChangeLog', previousLog, vscode.ConfigurationTarget.Global);
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('native virtual diff is not dirty; closing its tab settles discard', async () => {
    const pending = review.showReview({ original: source, rewritten: proposal });
    // Opening the diff is async. Wait for its public tab event, not a fixed sleep.
    const tab = await waitForReviewTab();
    const input = tab.input as vscode.TabInputTextDiff;
    assert.strictEqual(input.original.scheme, 'deslop-review');
    assert.strictEqual(input.modified.scheme, 'deslop-review');
    const document = await vscode.workspace.openTextDocument(input.modified);
    assert.strictEqual(document.getText(), proposal);
    assert.strictEqual(document.isDirty, false);
    assert.strictEqual(document.isUntitled, false);
    await vscode.commands.executeCommand('type', { text: 'not allowed' });
    assert.strictEqual(document.getText(), proposal, 'Native typing must not change a read-only preview');
    // WorkspaceEdit can bypass UI read-only state; the provider restores its
    // authoritative preview, and review actions block while it differs.
    const forbiddenEdit = new vscode.WorkspaceEdit();
    forbiddenEdit.insert(input.modified, new vscode.Position(0, 0), 'not allowed');
    await vscode.workspace.applyEdit(forbiddenEdit);
    await waitForContent(document, proposal);
    assert.strictEqual(document.getText(), proposal);
    assert.strictEqual(document.isDirty, false);
    await vscode.window.tabGroups.close(tab);
    assert.deepStrictEqual(await pending, { kind: 'discard' });
  });

  test('native tab switching and return keep the associated preview; cancellation closes it', async () => {
    const editor = await openSource();
    const pending = review.showReview({ original: source, rewritten: proposal });
    const tab = await waitForReviewTab();
    await vscode.window.showTextDocument(editor.document);
    await review.returnToReview();
    assert.strictEqual(vscode.window.tabGroups.activeTabGroup.activeTab, tab);
    assert.strictEqual(editor.document.getText(), source);
    review.cancelReview();
    assert.deepStrictEqual(await pending, { kind: 'discard' });
  });

  test('closing a native review group settles its pending session', async () => {
    const pending = review.showReview({ original: source, rewritten: proposal });
    const tab = await waitForReviewTab();
    const group = vscode.window.tabGroups.all.find(candidate => candidate.tabs.includes(tab))!;
    assert.ok(await vscode.window.tabGroups.close(group));
    assert.deepStrictEqual(await pending, { kind: 'discard' });
  });

  test('closing either duplicate native review discards the session in all groups', async () => {
    const pending = review.showReview({ original: source, rewritten: proposal });
    const tab = await waitForReviewTab();
    const input = tab.input as vscode.TabInputTextDiff;
    await vscode.commands.executeCommand('vscode.diff', input.original, input.modified, 'Duplicate review', { viewColumn: vscode.ViewColumn.Beside, preview: false });
    const matches = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(candidate =>
      candidate.input instanceof vscode.TabInputTextDiff && candidate.input.modified.toString() === input.modified.toString());
    assert.strictEqual(matches().length, 2);
    assert.ok(await vscode.window.tabGroups.close(tab));
    assert.deepStrictEqual(await pending, { kind: 'discard' });
    // Session settlement is synchronous; best-effort native tab closure is async.
    for (const remaining of matches()) { await vscode.window.tabGroups.close(remaining); }
  });

  test('workflow applies exact composed text to captured source despite tab switch; one Undo restores it', async () => {
    const editor = await openSource();
    const composed = 'Clear prose.\nAn unchanged anchor.\nMore padded prose.\n';
    reviewBoundary.showReview = async () => {
      await openSource('unrelated.md');
      return apply(composed);
    };
    const before = requestCount;
    await humanizeSelection({ secrets: {}, globalState: { get: () => undefined } } as unknown as vscode.ExtensionContext);
    assert.strictEqual(requestCount, before + 1);
    assert.strictEqual(editor.document.getText(), composed);
    const unrelated = documents.find(document => document.fileName.endsWith('unrelated.md'))!;
    assert.strictEqual(unrelated.getText(), source);
    await vscode.window.showTextDocument(editor.document);
    await vscode.commands.executeCommand('undo');
    assert.strictEqual(editor.document.getText(), source);
  });

  test('native source version change during review blocks the completed replacement', async () => {
    const editor = await openSource();
    reviewBoundary.showReview = async () => {
      assert.ok(await editor.edit(builder => builder.insert(new vscode.Position(0, 0), 'User edit.\n')));
      return apply(proposal);
    };
    await humanizeSelection({ secrets: {}, globalState: { get: () => undefined } } as unknown as vscode.ExtensionContext);
    assert.strictEqual(editor.document.getText(), 'User edit.\n' + source);
  });
});

suite('Native extension activation — no connection or inference invocation', () => {
  test('bundled extension activates and registers every contributed command once', async () => {
    const extension = vscode.extensions.getExtension('AUAggy.deslop');
    assert.ok(extension, 'Feature development extension must be present');
    await extension.activate(); // Activation registers handlers; it does not read a key.
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const command of extension.packageJSON.contributes.commands as Array<{ command: string }>) {
      assert.ok(registered.has(command.command), `Missing registered command: ${command.command}`);
    }
  });
});

function waitForContent(document: vscode.TextDocument, expected: string): Promise<void> {
  if (document.getText() === expected) { return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { subscription.dispose(); reject(new Error('Review content was not restored')); }, 8000);
    const subscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document === document && document.getText() === expected) {
        clearTimeout(timer); subscription.dispose(); resolve();
      }
    });
  });
}

function waitForReviewTab(): Promise<vscode.Tab> {
  const find = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
    tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'deslop-review');
  const current = find();
  if (current) { return Promise.resolve(current); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { subscription.dispose(); reject(new Error('Native review tab did not open')); }, 8000);
    const subscription = vscode.window.tabGroups.onDidChangeTabs(() => {
      const tab = find();
      if (tab) { clearTimeout(timer); subscription.dispose(); resolve(tab); }
    });
  });
}
