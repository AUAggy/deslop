import * as assert from 'assert';
import { classifyProviderError, ProviderError } from '../../api/errors';
import { replaceCredential } from '../../storage/credentialReplacement';
import { getApiKey, setApiKey, deleteApiKey } from '../../storage/secrets';
import type * as vscode from 'vscode';

suite('Connection security: safe errors', () => {
  const cases = [
    [{ status: 401 }, 'authentication'], [{ status: 402 }, 'credit'], [{ status: 429 }, 'rate-limit'],
    [{ status: 403 }, 'permission'], [{ status: 404 }, 'unknown'], [{ code: 'model_not_found' }, 'model'],
    [{ name: 'APIConnectionTimeoutError' }, 'timeout'], [{ name: 'APIConnectionError' }, 'network'],
    [{ name: 'AbortError' }, 'cancelled'], ['401 invalid_api_key', 'unknown'], [null, 'unknown'],
  ] as const;
  for (const [input, expected] of cases) {
    test(`classifies ${JSON.stringify(input)} conservatively`, () => {
      const raw = typeof input === 'object' && input ? { ...input, message: 'secret-key\nBearer credential\nprivate prose https://callback.invalid?code=sensitive' } : input;
      const safe = classifyProviderError(raw);
      assert.strictEqual(safe.category, expected);
      assert.ok(safe.message.length < 200);
      assert.doesNotMatch(JSON.stringify(safe) + safe.message, /secret-key|credential\n|private prose|callback.invalid|sensitive/);
    });
  }
  test('local integrity and malformed errors retain safe category', () => {
    for (const category of ['integrity', 'malformed'] as const) {
      assert.strictEqual(classifyProviderError(new ProviderError(category)).category, category);
    }
  });
});

suite('Connection security: credential replacement', () => {
  test('cancelled entry never verifies or stores', async () => {
    const result = await replaceCredential(undefined, 'venice', { cancelled: () => false, verify: async () => assert.fail(), save: async () => assert.fail() });
    assert.strictEqual(result, 'cancelled');
  });
  test('failed verification leaves existing key untouched', async () => {
    let old = 'old';
    const result = await replaceCredential('candidate', 'openrouter', { cancelled: () => false, verify: async () => { throw new Error('synthetic'); }, save: async key => { old = key; } });
    assert.strictEqual(result, 'verification-failed'); assert.strictEqual(old, 'old');
  });
  test('cancel during validation does not store', async () => {
    let cancelled = false;
    const result = await replaceCredential('candidate', 'openrouter', { cancelled: () => cancelled, verify: async () => { cancelled = true; }, save: async () => assert.fail() });
    assert.strictEqual(result, 'cancelled');
  });
  test('provider drift does not redirect validation or saving', async () => {
    let setting = 'openrouter';
    const calls: string[] = [];
    const result = await replaceCredential('candidate', 'openrouter', {
      cancelled: () => false,
      verify: async (_key, provider) => { calls.push(provider); setting = 'venice'; },
      save: async (_key, provider) => { calls.push(provider); },
    });
    assert.strictEqual(setting, 'venice'); assert.deepStrictEqual(calls, ['openrouter', 'openrouter']); assert.strictEqual(result, 'saved');
  });
  test('failed store is uncertain, never success or blind rollback', async () => {
    const result = await replaceCredential('candidate', 'venice', { cancelled: () => false, verify: async () => {}, save: async () => { throw new Error('synthetic storage failure'); } });
    assert.strictEqual(result, 'storage-uncertain');
  });
  test('legacy secret slots remain separate for explicit providers', async () => {
    const values = new Map<string, string>([['deslop.openrouterApiKey', 'old-router'], ['deslop.veniceApiKey', 'old-venice']]);
    const secrets = { get: async (key: string) => values.get(key), store: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } } as unknown as vscode.SecretStorage;
    assert.strictEqual(await getApiKey(secrets, 'openrouter'), 'old-router');
    await setApiKey(secrets, 'new-router', 'openrouter');
    assert.strictEqual(await getApiKey(secrets, 'venice'), 'old-venice');
    await deleteApiKey(secrets, 'venice');
    assert.strictEqual(await getApiKey(secrets, 'openrouter'), 'new-router');
    assert.strictEqual(await getApiKey(secrets, 'venice'), undefined);
  });
});
