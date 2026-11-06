import * as vscode from 'vscode';
import { resolveEditorialPreferences, type EditorialPreferences } from './preferences';

export function readEditorialPreferences(): EditorialPreferences {
  return resolveEditorialPreferences(vscode.workspace.getConfiguration('deslop'));
}

export function readRememberDocumentType(): boolean {
  return vscode.workspace.getConfiguration('deslop').inspect<boolean>('rememberDocumentType')?.globalValue === true;
}

export async function setRememberDocumentType(enabled: boolean): Promise<void> {
  await vscode.workspace.getConfiguration('deslop').update('rememberDocumentType', enabled, vscode.ConfigurationTarget.Global);
}

interface PreferenceItem extends vscode.QuickPickItem {
  key: keyof EditorialPreferences;
}

export interface PreferenceSettingsUI {
  read(): EditorialPreferences;
  chooseAction(): Promise<'edit' | 'reset' | undefined>;
  choose(items: PreferenceItem[]): Promise<PreferenceItem[] | undefined>;
  write(key: keyof EditorialPreferences, value: boolean): Promise<void>;
}

const nativeUI: PreferenceSettingsUI = {
  read: readEditorialPreferences,
  async chooseAction() {
    const picked = await vscode.window.showQuickPick([
      { label: 'Choose preferences', action: 'edit' as const },
      { label: 'Reset both preferences to off', action: 'reset' as const },
    ], { placeHolder: 'User settings only. Existing results do not change; regeneration may incur charges.' });
    return picked?.action;
  },
  async choose(items) {
    return vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select preferences, then confirm. Neither is an exact preservation guarantee.',
    });
  },
  async write(key, value) {
    await vscode.workspace.getConfiguration('deslop').update(key, value, vscode.ConfigurationTarget.Global);
  },
};

/** Call only from explicit user action. No regeneration or request is triggered here.
 * Writes are separate editor setting operations; a storage failure is propagated,
 * not reported as a completed save. Callers should reread settings after failure.
 */
export async function configureEditorialPreferences(ui: PreferenceSettingsUI = nativeUI): Promise<boolean> {
  const action = await ui.chooseAction();
  if (!action) { return false; }
  const current = ui.read();
  const items: PreferenceItem[] = [
    { label: 'Preserve punctuation style', key: 'preservePunctuationStyle', picked: current.preservePunctuationStyle },
    { label: 'Preserve paragraph/list structure', key: 'preserveParagraphListStructure', picked: current.preserveParagraphListStructure },
  ];
  const selected = action === 'reset' ? [] : await ui.choose(items);
  if (!selected) { return false; }
  const keys = new Set(selected.map(item => item.key));
  for (const item of items) {
    const next = keys.has(item.key);
    if (current[item.key] !== next) { await ui.write(item.key, next); }
  }
  return true;
}
