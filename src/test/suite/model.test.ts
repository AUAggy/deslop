import * as assert from 'assert';
import * as vscode from 'vscode';
import { resolveModel } from '../../api/providers';

const OPENROUTER_MODEL = 'openai/gpt-6-luna';
const VENICE_MODEL = 'openai-gpt-6-luna';
const OVERRIDE_SCOPES = [
  'globalValue',
  'workspaceValue',
  'workspaceFolderValue',
  'globalLanguageValue',
  'workspaceLanguageValue',
  'workspaceFolderLanguageValue',
] as const;

type ModelSetting = { defaultValue?: string } & Partial<Record<typeof OVERRIDE_SCOPES[number], string>>;

function fakeConfig(setting?: ModelSetting, effectiveModel = OPENROUTER_MODEL): vscode.WorkspaceConfiguration {
  return {
    inspect: () => setting,
    get: () => effectiveModel,
  } as unknown as vscode.WorkspaceConfiguration;
}

suite('resolveModel', () => {
  test('uses GPT-6 Luna on OpenRouter when no model override exists', () => {
    const cfg = fakeConfig({ defaultValue: OPENROUTER_MODEL });
    assert.strictEqual(resolveModel(cfg, OPENROUTER_MODEL), OPENROUTER_MODEL);
  });

  test('uses the Venice ID instead of the OpenRouter manifest default', () => {
    const cfg = fakeConfig({ defaultValue: OPENROUTER_MODEL });
    assert.strictEqual(resolveModel(cfg, VENICE_MODEL), VENICE_MODEL);
  });

  test('uses the provider default when inspect returns undefined', () => {
    assert.strictEqual(resolveModel(fakeConfig(), VENICE_MODEL), VENICE_MODEL);
  });

  for (const scope of OVERRIDE_SCOPES) {
    test(`preserves an explicit model from ${scope}`, () => {
      const cfg = fakeConfig({ defaultValue: OPENROUTER_MODEL, [scope]: 'custom-model' }, 'custom-model');
      assert.strictEqual(resolveModel(cfg, VENICE_MODEL), 'custom-model');
    });
  }

  test('preserves an explicit model even when it matches the manifest default', () => {
    const cfg = fakeConfig({ defaultValue: OPENROUTER_MODEL, globalValue: OPENROUTER_MODEL });
    assert.strictEqual(resolveModel(cfg, VENICE_MODEL), OPENROUTER_MODEL);
  });
});
