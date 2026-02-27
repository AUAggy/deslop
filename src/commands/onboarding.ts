import * as vscode from 'vscode';
import { getApiKey, setApiKey } from '../storage/secrets';
import { validateApiKey } from '../api/openrouter';

const PROVIDER_INFO = {
  openrouter: {
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-...',
  },
  venice: {
    name: 'Venice',
    keyUrl: 'https://venice.ai/settings/api',
    placeholder: 'venice-...',
  },
} as const;

function getProviderInfo() {
  const cfg = vscode.workspace.getConfiguration('deslop');
  const p = cfg.get<string>('provider', 'openrouter');
  return p === 'venice' ? PROVIDER_INFO.venice : PROVIDER_INFO.openrouter;
}

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

  const provider = getProviderInfo();
  const action = await vscode.window.showInformationMessage(
    `DeSlop needs a ${provider.name} API key. Enter it now or get one at ${provider.keyUrl}.`,
    'Enter Key',
    'Get Key'
  );

  if (action === 'Get Key') {
    vscode.env.openExternal(vscode.Uri.parse(provider.keyUrl));
    vscode.window.showInformationMessage(
      `Get your API key from ${provider.keyUrl}, then run DeSlop Selection again.`
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
  const provider = getProviderInfo();
  const key = await vscode.window.showInputBox({
    prompt: `Paste your ${provider.name} API key`,
    password: true,
    ignoreFocusOut: true,
    placeHolder: provider.placeholder,
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
      `API key not valid. Check your key at ${provider.keyUrl}.`,
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
