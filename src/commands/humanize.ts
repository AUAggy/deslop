import * as vscode from 'vscode';
import { ensureApiKey, promptAndSaveKey } from './onboarding';
import { callHumanize, isSelectionTooLong } from '../api/providers';
import { showDiffAndPrompt } from '../ui/diff';
import { showSpinner, hideSpinner } from '../ui/statusBar';
import { logChanges } from '../ui/changelog';
import { isProseSelection } from '../util/isProseSelection';
import type { DocumentType } from '../types';

const DOC_TYPE_ITEMS: Array<{ label: string; value: DocumentType }> = [
  { label: 'README', value: 'README' },
  { label: 'Docstring / Comment', value: 'Docstring/Comment' },
  { label: 'Commit Message', value: 'Commit Message' },
  { label: 'Blog / Article', value: 'Blog/Article' },
];

export function approximateWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function humanizeSelection(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Open a file and select text to humanize.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showErrorMessage(
      'Select the text you want to humanize first.'
    );
    return;
  }

  const selectedText = editor.document.getText(selection);
  const documentVersionAtStart = editor.document.version;

  // G5: reject code selections
  const prose = await isProseSelection(editor.document, selection);
  if (!prose) {
    vscode.window.showErrorMessage(
      'DeSlop rewrites prose, not code. Select a comment or documentation block.'
    );
    return;
  }

  // Token length guard -- show word count so user knows how much to trim
  if (isSelectionTooLong(selectedText)) {
    const wordCount = approximateWordCount(selectedText);
    vscode.window.showErrorMessage(
      `Selection is ~${wordCount.toLocaleString()} words. Limit is ~3,000. Select a shorter passage.`
    );
    return;
  }

  // API key
  const apiKey = await ensureApiKey(context.secrets);
  if (!apiKey) {
    return;
  }

  // Document type -- persist last choice across sessions via globalState
  const config = vscode.workspace.getConfiguration('deslop');
  const defaultType = config.get<DocumentType | null>('defaultDocumentType', null);
  let docType: DocumentType | undefined;

  if (defaultType) {
    docType = defaultType;
  } else {
    const lastDocType = context.globalState.get<DocumentType>('deslop.lastDocType');
    const items = lastDocType
      ? [
          DOC_TYPE_ITEMS.find((i) => i.value === lastDocType)!,
          ...DOC_TYPE_ITEMS.filter((i) => i.value !== lastDocType),
        ]
      : DOC_TYPE_ITEMS;

    const picked = await vscode.window.showQuickPick(
      items.map((i) => i.label),
      { placeHolder: 'Select document type' }
    );
    if (!picked) {
      return;
    }
    docType = DOC_TYPE_ITEMS.find((i) => i.label === picked)!.value;
    await context.globalState.update('deslop.lastDocType', docType);
  }

  // Status bar label: doc type + provider
  const provider = config.get<string>('provider', 'openrouter');
  const providerLabel = provider === 'venice' ? 'Venice' : 'OpenRouter';
  showSpinner(context, `${docType} via ${providerLabel}`);

  let result;
  try {
    result = await callHumanize(apiKey, selectedText, docType);
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const msg = rawMsg.slice(0, 500).split('\n')[0];

    if (msg.includes('timed out') || msg.includes('timeout')) {
      const action = await vscode.window.showErrorMessage(
        'Request timed out. Check your connection and try again.',
        'Retry'
      );
      if (action === 'Retry') {
        return humanizeSelection(context);
      }
      return;
    }

    if (
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('invalid_api_key')
    ) {
      const action = await vscode.window.showErrorMessage(
        'API key rejected. Check your key in your provider settings.',
        'Update Key'
      );
      if (action === 'Update Key') {
        await promptAndSaveKey(context.secrets);
      }
      return;
    }

    const action = await vscode.window.showErrorMessage(
      `API error: ${msg}`,
      'Retry'
    );
    if (action === 'Retry') {
      return humanizeSelection(context);
    }
    return;
  } finally {
    hideSpinner();
  }

  const autoAccept = config.get<boolean>('autoAccept', false);

  let accepted: boolean;
  if (autoAccept) {
    accepted = true;
  } else {
    accepted = await showDiffAndPrompt(selectedText, result.rewritten);
  }

  if (!accepted) {
    // Try Again lets the user re-run without re-selecting
    const again = await vscode.window.showInformationMessage(
      'Rewrite discarded.',
      'Try Again'
    );
    if (again === 'Try Again') {
      return humanizeSelection(context);
    }
    return;
  }

  // Guard: document may have changed during the async gap
  if (editor.document.isClosed || editor.document.version !== documentVersionAtStart) {
    vscode.window.showErrorMessage(
      'Document changed while humanizing. Re-select and try again.'
    );
    return;
  }

  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(editor.document.uri, selection, result.rewritten);
  await vscode.workspace.applyEdit(workspaceEdit);

  // Changelog
  const showLog = config.get<boolean>('showChangeLog', true);
  if (showLog) {
    logChanges(result.changes, docType);
  }

  // One-time tip to assign a keyboard shortcut -- shown after first successful accept
  if (!context.globalState.get('deslop.shownKeyboardTip')) {
    await context.globalState.update('deslop.shownKeyboardTip', true);
    const open = await vscode.window.showInformationMessage(
      'Tip: DeSlop Selection is bound to Shift+Alt+D by default. You can rebind it in Keyboard Shortcuts.',
      'Open Keyboard Shortcuts'
    );
    if (open === 'Open Keyboard Shortcuts') {
      vscode.commands.executeCommand('workbench.action.openGlobalKeybindings');
    }
  }
}
