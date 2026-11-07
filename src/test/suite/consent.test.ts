import * as assert from 'assert';
import * as vscode from 'vscode';
import { readTrustedBoolean } from '../../commands/humanize';

function fakeConfig(values: {
  defaultValue?: boolean;
  globalValue?: boolean;
  workspaceValue?: boolean;
  workspaceFolderValue?: boolean;
}): vscode.WorkspaceConfiguration {
  return {
    inspect: <T>() => values as unknown as {
      defaultValue?: T;
      globalValue?: T;
      workspaceValue?: T;
      workspaceFolderValue?: T;
    },
    get: () => undefined,
    has: () => false,
    update: async () => undefined,
  } as unknown as vscode.WorkspaceConfiguration;
}

suite('readTrustedBoolean', () => {
  test('returns globalValue when set', () => {
    const cfg = fakeConfig({ defaultValue: false, globalValue: true, workspaceValue: false });
    assert.strictEqual(readTrustedBoolean(cfg, 'autoAccept', false), true);
  });

  test('ignores workspaceValue even when truthy', () => {
    const cfg = fakeConfig({ defaultValue: false, workspaceValue: true });
    assert.strictEqual(readTrustedBoolean(cfg, 'autoAccept', false), false);
  });

  test('ignores workspaceFolderValue even when truthy', () => {
    const cfg = fakeConfig({ defaultValue: false, workspaceFolderValue: true });
    assert.strictEqual(readTrustedBoolean(cfg, 'autoAccept', false), false);
  });

  test('falls back to defaultValue when no globalValue', () => {
    const cfg = fakeConfig({ defaultValue: true });
    assert.strictEqual(readTrustedBoolean(cfg, 'showChangeLog', false), true);
  });

  test('falls back to fallback param when inspect returns nothing', () => {
    const cfg = {
      inspect: () => undefined,
    } as unknown as vscode.WorkspaceConfiguration;
    assert.strictEqual(readTrustedBoolean(cfg, 'showChangeLog', true), true);
  });

  test('globalValue=false overrides defaultValue=true', () => {
    const cfg = fakeConfig({ defaultValue: true, globalValue: false, workspaceValue: true });
    assert.strictEqual(readTrustedBoolean(cfg, 'showChangeLog', true), false);
  });
});
