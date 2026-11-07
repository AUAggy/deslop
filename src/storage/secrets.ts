import * as vscode from 'vscode';
import { activeProvider, type Provider } from '../api/providers';

const KEYS = {
  openrouter: 'deslop.openrouterApiKey',
  venice: 'deslop.veniceApiKey',
} as const;

export async function getApiKey(
  secrets: vscode.SecretStorage,
  provider: Provider = activeProvider()
): Promise<string | undefined> {
  return secrets.get(KEYS[provider]);
}

export async function setApiKey(
  secrets: vscode.SecretStorage,
  key: string,
  provider: Provider = activeProvider()
): Promise<void> {
  await secrets.store(KEYS[provider], key);
}

export async function deleteApiKey(
  secrets: vscode.SecretStorage,
  provider: Provider = activeProvider()
): Promise<void> {
  await secrets.delete(KEYS[provider]);
}
