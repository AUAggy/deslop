import * as vscode from 'vscode';
import { getApiKey, setApiKey } from '../storage/secrets';
import { validateApiKey } from '../api/openrouter';

/**
 * Ensures a valid API key is stored. Returns the key, or undefined if the
 * user cancelled or validation failed.
 */
export async function ensureApiKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const existing = await getApiKey(secrets);
  if (existing) {
    return existing;
  }

  const action = await vscode.window.showInformationMessage(
    'DeSlop needs an OpenRouter API key. Enter it now or get one at openrouter.ai/keys.',
    'Enter Key',
    'Get Key'
  );

  if (action === 'Get Key') {
    vscode.env.openExternal(vscode.Uri.parse('https://openrouter.ai/keys'));
    vscode.window.showInformationMessage(
      'Get your API key from openrouter.ai/keys, then run Humanize Selection again.'
    );
    return undefined;
  }

  if (action !== 'Enter Key') {
    return undefined;
  }

  return promptAndSaveKey(secrets);
}

export async function promptAndSaveKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    prompt: 'Paste your OpenRouter API key',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-or-...',
  });

  if (!key) {
    return undefined;
  }

  const validationResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Validating API key...',
      cancellable: false,
    },
    () => validateApiKey(key)
  );

  if (validationResult === 'network-error') {
    vscode.window.showErrorMessage(
      'Could not reach OpenRouter. Check your connection and try again.'
    );
    return undefined;
  }

  if (validationResult !== 'valid') {
    const retry = await vscode.window.showErrorMessage(
      'API key not valid. Check your key at openrouter.ai/keys.',
      'Try Again'
    );
    if (retry === 'Try Again') {
      return promptAndSaveKey(secrets);
    }
    return undefined;
  }

  await setApiKey(secrets, key);
  vscode.window.showInformationMessage('Key saved. Ready to deslop.');
  return key;
}
