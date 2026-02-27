import * as vscode from 'vscode';

const KEYS = {
  openrouter: 'humanizer.openrouterApiKey',
  venice: 'humanizer.veniceApiKey',
} as const;

type Provider = keyof typeof KEYS;

function activeProvider(): Provider {
  const cfg = vscode.workspace.getConfiguration('deslop');
  const p = cfg.get<string>('provider', 'openrouter');
  return p === 'venice' ? 'venice' : 'openrouter';
}

export async function getApiKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  return secrets.get(KEYS[activeProvider()]);
}

export async function setApiKey(
  secrets: vscode.SecretStorage,
  key: string
): Promise<void> {
  await secrets.store(KEYS[activeProvider()], key);
}

export async function deleteApiKey(
  secrets: vscode.SecretStorage
): Promise<void> {
  await secrets.delete(KEYS[activeProvider()]);
}
