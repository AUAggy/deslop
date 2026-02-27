import * as vscode from 'vscode';
import { ensureApiKey, promptAndSaveKey } from './onboarding';
import { callHumanize, isSelectionTooLong } from '../api/openrouter';
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

  // G5: reject code selections
  const prose = await isProseSelection(editor.document, selection);
  if (!prose) {
    vscode.window.showErrorMessage(
      'Humanizer rewrites prose, not code. Select a comment or documentation block.'
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
  const config = vscode.workspace.getConfiguration('humanizer');
  const defaultType = config.get<DocumentType | null>('defaultDocumentType', null);
  let docType: DocumentType | undefined = defaultType ?? lastDocType;

  if (!docType) {
    const picked = await vscode.window.showQuickPick(
      DOC_TYPE_ITEMS.map((i) => i.label),
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
    hideSpinner();
    const msg = err instanceof Error ? err.message : String(err);

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
        'API key rejected. Check your key at openrouter.ai/keys.',
        'Update Key'
      );
      if (action === 'Update Key') {
        await promptAndSaveKey(context.secrets);
      }
      return;
    }

    const action = await vscode.window.showErrorMessage(
      'OpenRouter API returned an error. Try again in a moment.',
      'Retry'
    );
    if (action === 'Retry') {
      return humanizeSelection(context);
    }
    return;
  } finally {
    hideSpinner();
  }

  // Diff view + Accept/Discard
  const accepted = await showDiffAndPrompt(selectedText, result.rewritten);
  if (!accepted) {
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
