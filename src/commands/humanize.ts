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

let lastDocType: DocumentType | undefined;

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

  // Token length guard
  if (isSelectionTooLong(selectedText)) {
    vscode.window.showErrorMessage(
      'Selection exceeds ~3,000 words. Select a shorter passage.'
    );
    return;
  }

  // API key
  const apiKey = await ensureApiKey(context.secrets);
  if (!apiKey) {
    return;
  }

  // Document type
  const config = vscode.workspace.getConfiguration('deslop');
  const defaultType = config.get<DocumentType | null>('defaultDocumentType', null);
  let docType: DocumentType | undefined;

  if (defaultType) {
    // Setting overrides: skip Quick Pick entirely
    docType = defaultType;
  } else {
    // Always show Quick Pick; put last-used type first if available
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
  }

  lastDocType = docType;

  // Inference
  showSpinner(context);
  let result;
  try {
    result = await callHumanize(apiKey, selectedText, docType);
  } catch (err: unknown) {
    // Extract a safe, short message — never log or display the full error object
    // which could contain request headers including the API key
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
      'API returned an error. Try again in a moment.',
      'Retry'
    );
    if (action === 'Retry') {
      return humanizeSelection(context);
    }
    return;
  } finally {
    hideSpinner();
  }

  // Check autoAccept before diff view
  const autoAccept = config.get<boolean>('autoAccept', false);

  let accepted: boolean;
  if (autoAccept) {
    accepted = true;
  } else {
    accepted = await showDiffAndPrompt(selectedText, result.rewritten);
  }

  if (!accepted) {
    return;
  }

  // Guard: document may have changed during the async gap
  if (editor.document.isClosed || editor.document.version !== documentVersionAtStart) {
    vscode.window.showErrorMessage(
      'Document changed while humanizing. Re-select and try again.'
    );
    return;
  }

  // Replace selection in editor
  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, result.rewritten);
  });

  // Changelog
  const showLog = config.get<boolean>('showChangeLog', true);
  if (showLog) {
    logChanges(result.changes);
  }
}
