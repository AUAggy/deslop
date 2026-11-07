import * as assert from 'assert';
import { createHash } from 'crypto';
import { AUTH_LIFETIME_MS, PkceSession } from '../../api/pkce';
import { OPENROUTER_TIMEOUT_MESSAGE, openRouterAuthFailureMessage } from '../../api/authMessages';
import { classifyProviderError, ProviderError } from '../../api/errors';
import { replaceCredential } from '../../storage/credentialReplacement';
import { getApiKey, setApiKey, deleteApiKey } from '../../storage/secrets';
import type * as vscode from 'vscode';

function callback(s: PkceSession, query = 'code=synthetic-code') {
  return { scheme: s.scheme, authority: s.authority, path: s.path, fragment: '', query };
}
suite('Connection security: PKCE', () => {
  test('S256 challenge matches verifier and independent random route binds session', () => {
    const s = new PkceSession('vscode', 'AUAggy.deslop');
    const other = new PkceSession('vscode', 'AUAggy.deslop');
    assert.notStrictEqual(s.path, other.path);
    assert.notStrictEqual(s.challenge, other.challenge);
    const url = new URL(s.authorizationUrl('vscode://AUAggy.deslop' + s.path));
    assert.strictEqual(url.origin, 'https://openrouter.ai');
    assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
    const fields = s.consume(callback(s));
    assert.strictEqual(fields.code_challenge_method, 'S256');
    assert.match(fields.code_verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.strictEqual(createHash('sha256').update(fields.code_verifier).digest('base64url'), s.challenge);
    assert.throws(() => s.consume(callback(s)), ProviderError);
  });
  for (const [field, value] of [['scheme', 'https'], ['authority', 'attacker.invalid'], ['path', '/connect/openrouter/unbound'], ['fragment', 'code=unexpected']]) {
    test(`rejects wrong ${field}`, () => {
      const s = new PkceSession('vscode', 'AUAggy.deslop');
      assert.throws(() => s.consume({ ...callback(s), [field]: value }), ProviderError);
    });
  }
  for (const query of ['', 'code=', 'code=a&code=b', 'code=a&state=b', 'code=a&error=denied', 'error=denied&error=denied', 'code=%00', 'code=%20', 'code=a&redirect_uri=https://attacker.invalid', 'code=' + 'a'.repeat(4097)]) {
    test(`rejects malformed query case ${query.slice(0, 28)}`, () => {
      const s = new PkceSession('vscode', 'AUAggy.deslop');
      assert.throws(() => s.consume(callback(s, query)), ProviderError);
    });
  }
  test('denial terminates attempt', () => {
    const s = new PkceSession('vscode', 'AUAggy.deslop');
    assert.throws(() => s.consume(callback(s, 'error=access_denied')), (e: unknown) => e instanceof ProviderError && e.category === 'cancelled');
    assert.throws(() => s.consume(callback(s)), ProviderError);
  });
  test('expires exactly at deadline', () => {
    let now = 1000;
    const s = new PkceSession('vscode', 'AUAggy.deslop', () => now);
    now += AUTH_LIFETIME_MS;
    assert.throws(() => s.consume(callback(s)), ProviderError);
  });
  test('cancellation destroys verifier', () => {
    const s = new PkceSession('vscode', 'AUAggy.deslop');
    s.cancel();
    assert.throws(() => s.consume(callback(s)), ProviderError);
  });
});

suite('Connection security: PKCE external-callback binding', () => {
  const preset = 'windowId=1'; // asExternalUri adds this to EXTERNAL callbacks on desktop.

  function bound(s: PkceSession) { s.registerExternalCallback(callback(s, preset)); return s; }

  test('registered external callback preset plus ampersand-joined code consumes', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const fields = s.consume(callback(s, `${preset}&code=synthetic-code`));
    assert.match(fields.code_verifier, /^[A-Za-z0-9_-]{43}$/);
  });

  test('naive question-mark join of preset and code consumes after bounded canonicalisation', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const fields = s.consume(callback(s, `${preset}?code=synthetic-code`));
    assert.strictEqual(fields.code_challenge_method, 'S256');
  });

  test('canonicalisation stays bounded to the exact registered prefix', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => s.consume(callback(s, `${preset}??code=synthetic-code`)), ProviderError);
    const t = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => t.consume(callback(t, `${preset}?code=x?error=y`)), ProviderError);
    const u = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => u.consume(callback(u, 'windowId=2?code=synthetic-code')), ProviderError);
  });

  test('preset-only callback without a code or error still rejects', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => s.consume(callback(s, preset)), ProviderError);
  });

  test('preset value mismatch rejects and disarms the session', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => s.consume(callback(s, 'windowId=2&code=synthetic-code')), ProviderError);
    assert.throws(() => s.consume(callback(s, `${preset}&code=synthetic-code`)), ProviderError);
  });

  test('missing preset with clean code rejects on a bound session', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => s.consume(callback(s, 'code=synthetic-code')), ProviderError);
  });

  test('unknown extra parameter rejects even with a valid code', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => s.consume(callback(s, `${preset}&code=x&state=zzz`)), ProviderError);
  });

  test('denial on the bound callback terminates the attempt', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => s.consume(callback(s, `${preset}&error=access_denied`)), (e: unknown) => e instanceof ProviderError && e.category === 'cancelled');
    assert.throws(() => s.consume(callback(s, `${preset}&code=synthetic-code`)), ProviderError);
  });

  test('replay after a bound consume rejects', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    s.consume(callback(s, `${preset}?code=synthetic-code`));
    assert.throws(() => s.consume(callback(s, `${preset}?code=synthetic-code`)), ProviderError);
  });

  test('wrong path, authority, or scheme never consumes and the session stays armed', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => s.consume({ ...callback(s), path: '/connect/openrouter/foreign' }), ProviderError);
    assert.throws(() => s.consume({ ...callback(s), authority: 'attacker.invalid' }), ProviderError);
    assert.throws(() => s.consume({ ...callback(s), scheme: 'https' }), ProviderError);
    const fields = s.consume(callback(s, `${preset}&code=synthetic-code`));
    assert.strictEqual(fields.code_challenge_method, 'S256');
  });

  test('preset params cannot bypass path binding', () => {
    const s = new PkceSession('vscode', 'AUAggy.deslop');
    assert.throws(() => s.registerExternalCallback({ scheme: s.scheme, authority: s.authority, path: '/connect/openrouter/forged', query: preset, fragment: '' }), ProviderError);
    assert.throws(() => s.consume({ scheme: s.scheme, authority: s.authority, path: '/connect/openrouter/forged', query: `${preset}&code=synthetic-code`, fragment: '' }), ProviderError);
    const t = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    assert.throws(() => t.consume({ ...callback(t), path: '/connect/openrouter/forged', query: `${preset}&code=synthetic-code` }), ProviderError);
  });

  for (const [label, query] of [['preset named code', 'code=x'], ['duplicate preset name', 'windowId=1&windowId=1'], ['oversized preset', `windowId=${'a'.repeat(4097)}`]] as const) {
    test(`registerExternalCallback rejects ${label}`, () => {
      const s = new PkceSession('vscode', 'AUAggy.deslop');
      assert.throws(() => s.registerExternalCallback(callback(s, query)), ProviderError);
    });
  }

  test('registerExternalCallback rejects a fragment and rejects rebinding', () => {
    const s = new PkceSession('vscode', 'AUAggy.deslop');
    assert.throws(() => s.registerExternalCallback({ ...callback(s, preset), fragment: 'x' }), ProviderError);
    s.registerExternalCallback(callback(s, preset));
    assert.throws(() => s.registerExternalCallback(callback(s, preset)), ProviderError);
    const fields = s.consume(callback(s, `${preset}&code=synthetic-code`));
    assert.match(fields.code_verifier, /^[A-Za-z0-9_-]{43}$/);
  });

  test('binding does not extend the expiry deadline', () => {
    let now = 1000;
    const s = new PkceSession('vscode', 'AUAggy.deslop', () => now);
    now += AUTH_LIFETIME_MS;
    s.registerExternalCallback(callback(s, preset));
    assert.throws(() => s.consume(callback(s, `${preset}&code=synthetic-code`)), (e: unknown) => e instanceof ProviderError && e.category === 'cancelled');
  });

  test('failure details are distinct, static, and carry no callback values', () => {
    function caught(run: () => void): ProviderError {
      try { run(); } catch (error) { return error as ProviderError; }
      throw new Error('expected a throw');
    }
    const malformed = caught(() => {
      const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
      s.consume(callback(s, 'windowId=2&code=synthetic-code'));
    });
    const denied = caught(() => {
      const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
      s.consume(callback(s, `${preset}&error=access_denied`));
    });
    let now = 1000;
    const expiring = new PkceSession('vscode', 'AUAggy.deslop', () => now);
    now += AUTH_LIFETIME_MS;
    expiring.registerExternalCallback(callback(expiring, preset));
    const expired = caught(() => expiring.consume(callback(expiring, `${preset}&code=synthetic-code`)));
    for (const error of [malformed, denied, expired]) {
      assert.ok(error instanceof ProviderError);
      assert.ok(error.message.length > 20 && error.message.length < 300);
      // Values are banned from messages; parameter NAMES such as windowId are allowed by the reporting contract.
      assert.doesNotMatch(error.message, /synthetic-code|access_denied/);
    }
    assert.notStrictEqual(malformed.message, denied.message);
    assert.notStrictEqual(malformed.message, expired.message);
    assert.notStrictEqual(denied.message, expired.message);
    assert.strictEqual(classifyProviderError(malformed).message, malformed.message);
  });

  test('authorisation URL carries the documented key label alongside the bound callback', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const url = new URL(s.authorizationUrl(`vscode://AUAggy.deslop${s.path}?${preset}`));
    assert.strictEqual(url.searchParams.get('key_label'), 'DeSlop');
    assert.strictEqual(url.searchParams.get('callback_url'), `vscode://AUAggy.deslop${s.path}?${preset}`);
    assert.match(url.searchParams.get('code_challenge')!, /^[A-Za-z0-9_-]{43}$/);
  });
});

suite('Connection security: PKCE failure reporting', () => {
  const preset = 'windowId=1';

  function bound(s: PkceSession) { s.registerExternalCallback(callback(s, preset)); return s; }

  function detailOf(run: () => void): ProviderError {
    try { run(); } catch (error) { return error as ProviderError; }
    throw new Error('expected a throw');
  }

  test('unexpected callback parameter names the offender exactly', () => {
    const s = new PkceSession('vscode', 'AUAggy.deslop');
    const error = detailOf(() => s.consume(callback(s, 'code=x&windowId=1')));
    assert.strictEqual(error.category, 'malformed');
    assert.strictEqual(error.message, 'malformed callback: unexpected query parameter "windowId" (registered preset parameters plus exactly one of "code" or "error" are allowed)');
  });

  test('duplicate callback parameter names the duplicate exactly', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const error = detailOf(() => s.consume(callback(s, 'windowId=1&windowId=1&code=x')));
    assert.strictEqual(error.message, 'malformed callback: duplicate query parameter "windowId"');
  });

  test('missing registered preset names the parameter exactly', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const error = detailOf(() => s.consume(callback(s, 'code=x')));
    assert.strictEqual(error.message, 'malformed callback: missing registered query parameter "windowId"');
  });

  test('changed registered preset names the parameter exactly', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const error = detailOf(() => s.consume(callback(s, 'windowId=2&code=x')));
    assert.strictEqual(error.message, 'malformed callback: query parameter "windowId" does not match the registered callback value');
  });

  test('both code and error present states the conflict exactly', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const error = detailOf(() => s.consume(callback(s, 'windowId=1&code=x&error=whatever-value')));
    assert.strictEqual(error.message, 'malformed callback: both "code" and "error" query parameters present');
  });

  test('unsupported code format states the reason exactly', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const error = detailOf(() => s.consume(callback(s, 'windowId=1&code=%20')));
    assert.strictEqual(error.message, 'malformed callback: "code" query parameter is empty, overlong, or not printable ASCII');
  });

  test('denial states the browser origin exactly without the error value', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const error = detailOf(() => s.consume(callback(s, 'windowId=1&error=super_secret_denied_value')));
    assert.strictEqual(error.category, 'cancelled');
    assert.strictEqual(error.message, 'authorisation denied or cancelled in the browser (callback carried an "error" parameter)');
    assert.doesNotMatch(error.message, /super_secret_denied_value/);
  });

  test('expiry and reuse states are distinct and exact', () => {
    let now = 1000;
    const expiring = new PkceSession('vscode', 'AUAggy.deslop', () => now);
    now += AUTH_LIFETIME_MS;
    expiring.registerExternalCallback(callback(expiring, preset));
    const expired = detailOf(() => expiring.consume(callback(expiring, 'windowId=1&code=x')));
    assert.strictEqual(expired.message, 'connection window expired after 5 minutes without a valid callback');
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    s.consume(callback(s, 'windowId=1&code=x'));
    const reused = detailOf(() => s.consume(callback(s, 'windowId=1&code=x')));
    assert.strictEqual(reused.message, 'connection already completed or cancelled; the callback cannot reuse it');
  });

  test('foreign path and fragment rejections are exact', () => {
    const s = bound(new PkceSession('vscode', 'AUAggy.deslop'));
    const foreign = detailOf(() => s.consume({ scheme: s.scheme, authority: s.authority, path: '/connect/openrouter/other', query: 'windowId=1&code=x', fragment: '' }));
    assert.strictEqual(foreign.message, `malformed callback: callback does not target this session's registered path`);
    const fragment = detailOf(() => s.consume({ ...callback(s, 'windowId=1&code=x'), fragment: 'tail' }));
    assert.strictEqual(fragment.message, 'malformed callback: callback URI must not carry a fragment');
  });

  test('exchange and verification failures report phase and HTTP status exactly', () => {
    assert.strictEqual(openRouterAuthFailureMessage('exchange', { status: 403 }), 'key exchange failed (HTTP 403): The provider refused this request. Check account permissions; this does not establish that the key is invalid.');
    assert.strictEqual(openRouterAuthFailureMessage('exchange', { status: 400 }), 'key exchange failed (HTTP 400): The provider request failed. Check your account or retry explicitly.');
    assert.strictEqual(openRouterAuthFailureMessage('exchange', { name: 'APIConnectionError' }), 'key exchange failed: The provider could not be reached. Check your connection and retry.');
    assert.strictEqual(openRouterAuthFailureMessage('verify', { status: 401 }), 'authentication check failed (HTTP 401): The provider rejected this credential. Replace the key.');
    assert.strictEqual(openRouterAuthFailureMessage('save', { name: 'AbortError' }), 'credential saving failed: Request cancelled. Provider usage charges may still apply.');
  });

  test('callback-phase failures surface their precise detail verbatim', () => {
    const s = new PkceSession('vscode', 'AUAggy.deslop');
    const error = detailOf(() => s.consume(callback(s, 'code=x&state=y')));
    assert.strictEqual(openRouterAuthFailureMessage('callback', error), 'malformed callback: unexpected query parameter "state" (registered preset parameters plus exactly one of "code" or "error" are allowed)');
  });

  test('timeout warning is static, mentions the permission prompt, and leaks nothing', () => {
    assert.strictEqual(OPENROUTER_TIMEOUT_MESSAGE, 'OpenRouter connection window timed out after 5 minutes with no valid callback. A declined browser or editor permission prompt prevents completion. Use Enter Key for manual setup, or start a new connection. If saving failed, check the stored connection before retrying.');
  });

  test('failure reporting never echoes hostile raw error content', () => {
    const hostile = { message: 'secret-key Bearer https://callback.invalid?code=sensitive', status: 401 };
    const shown = openRouterAuthFailureMessage('exchange', hostile);
    assert.doesNotMatch(shown, /secret-key|callback\.invalid|sensitive/);
    assert.strictEqual(shown, 'key exchange failed (HTTP 401): The provider rejected this credential. Replace the key.');
  });
});

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
