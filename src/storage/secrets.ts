import * as vscode from 'vscode';

const KEY = 'humanizer.openrouterApiKey';

export async function getApiKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  return secrets.get(KEY);
}

export async function setApiKey(
  secrets: vscode.SecretStorage,
  key: string
): Promise<void> {
  await secrets.store(KEY, key);
}

export async function deleteApiKey(
  secrets: vscode.SecretStorage
): Promise<void> {
  await secrets.delete(KEY);
}
