/* Deterministic Node-only boundary tests. Run after compile; no provider traffic or editor launch. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let handler, opened, gets, posts, stores, completions, info, inputs, warnings, picked, cancelled, active, getImpl, postImpl, createImpl, storeImpl;
const disposable = () => ({ dispose() {} });
const secrets = {
  get: async slot => stores.get(slot),
  store: async (slot, key) => { if (storeImpl) await storeImpl(slot, key); stores.set(slot, key); },
  delete: async slot => { stores.delete(slot); },
};
const uri = value => {
  const parsed = new URL(value);
  return { scheme: parsed.protocol.slice(0, -1), authority: parsed.host, path: parsed.pathname, query: parsed.search.slice(1), fragment: parsed.hash.slice(1), toString: () => value };
};
const fakeVscode = {
  Disposable: class { constructor(fn) { this.dispose = fn; } },
  ProgressLocation: { Notification: 15 },
  Uri: { parse: uri, from: x => uri(`${x.scheme}://${x.authority}${x.path}`) },
  workspace: { getConfiguration: () => ({ get: (key, fallback) => key === 'provider' ? active : fallback, inspect: () => undefined }) },
  env: { uriScheme: 'vscode', asExternalUri: async x => x, openExternal: async x => { opened = x; return true; } },
  window: {
    registerUriHandler: x => { handler = x; return disposable(); },
    showInformationMessage: async () => info.shift(),
    showErrorMessage: async () => info.shift(),
    showWarningMessage: async () => warnings.shift(),
    showInputBox: async () => inputs.shift(),
    showQuickPick: async () => picked.shift(),
    withProgress: async (_opts, fn) => fn({}, { isCancellationRequested: false, onCancellationRequested: fn => { cancelled = fn; return disposable(); } }),
  },
};
class FakeOpenAI {
  constructor(options) {
    assert.equal(options.maxRetries, 0);
    this.options = options;
    this.chat = { completions: { create: async (body, options) => {
      completions.push({ body, options, client: this.options });
      return createImpl ? createImpl(body, options) : { choices: [{ message: { content: '{"rewritten":"Clear text.","changes":[]}' } }] };
    } } };
  }
  async get(path, options) { gets.push({ path, options, client: this.options }); return getImpl ? getImpl(path, options) : { data: {} }; }
  async post(path, options) { posts.push({ path, options, client: this.options }); return postImpl ? postImpl(path, options) : { key: 'synthetic-exchanged-key' }; }
}
Module._load = function(id, ...args) {
  if (id === 'vscode') return fakeVscode;
  if (id === 'openai') return FakeOpenAI;
  return originalLoad.call(this, id, ...args);
};
const onboarding = require('../../out/commands/onboarding');
const auth = require('../../out/commands/connectionAuth');
const api = require('../../out/api/providers');
const tick = () => new Promise(r => setImmediate(r));
function reset() {
  opened = undefined; gets = []; posts = []; completions = []; stores = new Map([['deslop.openrouterApiKey', 'old-router'], ['deslop.veniceApiKey', 'old-venice']]);
  inputs = []; info = []; warnings = []; picked = []; active = 'openrouter';
  getImpl = postImpl = createImpl = storeImpl = undefined;
}
let count = 0;
async function check(name, fn) { reset(); await fn(); count++; console.log(`PASS ${name}`); }
async function startAuth(signal) {
  info.push('Continue');
  const result = auth.connectOpenRouter(signal);
  await tick();
  assert.ok(opened, 'browser opened');
  const url = new URL(opened.toString());
  assert.equal(url.origin, 'https://openrouter.ai');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  return { result, callback: url.searchParams.get('callback_url') };
}
async function main() {
  await check('replacement cancel preserves working credential', async () => {
    await onboarding.resetApiKey(secrets, 'openrouter');
    assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router'); assert.equal(gets.length, 0);
  });
  await check('invalid replacement preserves both credentials', async () => {
    inputs.push('synthetic-candidate'); getImpl = async () => { throw { status: 401, message: 'SECRET' }; };
    await onboarding.promptAndSaveKey(secrets, 'openrouter');
    assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router'); assert.equal(stores.get('deslop.veniceApiKey'), 'old-venice');
  });
  await check('provider drift during replacement is captured', async () => {
    inputs.push('synthetic-candidate'); getImpl = async () => { active = 'venice'; return { data: {} }; };
    await onboarding.promptAndSaveKey(secrets, 'openrouter');
    assert.equal(gets[0].path, '/key'); assert.equal(stores.get('deslop.openrouterApiKey'), 'synthetic-candidate'); assert.equal(stores.get('deslop.veniceApiKey'), 'old-venice');
    assert.equal(completions.length, 0);
  });
  await check('replacement storage failure is not returned as success', async () => {
    inputs.push('synthetic-candidate'); storeImpl = async () => { throw new Error('synthetic storage failure'); };
    assert.equal(await onboarding.promptAndSaveKey(secrets, 'venice'), undefined);
    assert.equal(gets[0].path, '/api_keys/rate_limits'); assert.equal(stores.get('deslop.veniceApiKey'), 'old-venice');
  });
  await check('disconnect requires confirmation and removes only captured provider', async () => {
    await onboarding.disconnectProvider(secrets, 'venice'); assert.equal(stores.size, 2);
    warnings.push('Disconnect'); await onboarding.disconnectProvider(secrets, 'venice');
    assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router'); assert.equal(stores.has('deslop.veniceApiKey'), false);
  });
  await check('Get Key continues to manual entry without restarting caller', async () => {
    stores.delete('deslop.veniceApiKey'); info.push('Get Key', 'Enter Key'); inputs.push('synthetic-candidate');
    assert.equal(await onboarding.ensureApiKey(secrets, 'venice'), 'synthetic-candidate'); assert.ok(opened);
  });
  await check('browser failure allows resumable manual setup', async () => {
    const old = fakeVscode.env.openExternal; fakeVscode.env.openExternal = async () => false;
    try {
      stores.delete('deslop.veniceApiKey'); info.push('Get Key', 'Enter Key'); inputs.push('synthetic-candidate');
      assert.equal(await onboarding.ensureApiKey(secrets, 'venice'), 'synthetic-candidate');
    } finally { fakeVscode.env.openExternal = old; }
  });
  await check('model test requires charge consent', async () => {
    picked.push('Test Model Readiness (may incur charges)'); await onboarding.manageConnection(secrets, 'openrouter'); assert.equal(completions.length, 0);
    picked.push('Test Model Readiness (may incur charges)'); warnings.push('Run Test'); await onboarding.manageConnection(secrets, 'openrouter'); assert.equal(completions.length, 1);
  });
  await check('inference captures provider/model/signal and bounded preferences', async () => {
    active = 'venice'; const controller = new AbortController();
    await api.callHumanize('synthetic', 'Clear text.', 'readme', { provider: 'openrouter', model: 'captured-model', signal: controller.signal, preferenceInstructions: 'Preserve paragraph and list organisation where possible; meaning takes priority.' });
    assert.equal(completions[0].client.baseURL, 'https://openrouter.ai/api/v1'); assert.equal(completions[0].body.model, 'captured-model'); assert.equal(completions[0].options.signal, controller.signal);
    assert.match(completions[0].body.messages[0].content, /Preserve paragraph/);
  });
  await check('disabled preferences preserve the original system prompt exactly', async () => {
    const { SYSTEM_PROMPT } = require('../../out/prompts/system'); const { MODIFIERS } = require('../../out/prompts/modifiers');
    await api.callHumanize('synthetic', 'Clear text.', 'readme', { provider: 'openrouter', model: 'captured', preferenceInstructions: '' });
    assert.equal(completions[0].body.messages[0].content, `${SYSTEM_PROMPT}\n\n${MODIFIERS.readme}`);
  });
  await check('abort before inference and oversized instructions make no request', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.callHumanize('synthetic', 'Text', 'readme', { provider: 'openrouter', model: 'captured', signal: controller.signal }), e => e.category === 'cancelled');
    await assert.rejects(api.callHumanize('synthetic', 'Text', 'readme', { provider: 'openrouter', model: 'captured', preferenceInstructions: 'x'.repeat(2001) }), e => e.category === 'malformed');
    assert.equal(completions.length, 0);
  });
  await check('late cancelled response is rejected', async () => {
    const controller = new AbortController(); createImpl = async () => { controller.abort(); return { choices: [{ message: { content: '{"rewritten":"Clear text.","changes":[]}' } }] }; };
    await assert.rejects(api.callHumanize('synthetic', 'Clear text.', 'readme', { provider: 'openrouter', model: 'captured', signal: controller.signal }), e => e.category === 'cancelled');
  });
  await check('malformed response and integrity failure remain distinct', async () => {
    createImpl = async () => ({ choices: [{ message: { content: 'null' } }] });
    await assert.rejects(api.callHumanize('synthetic', 'Text', 'readme'), e => e.category === 'malformed');
    createImpl = async () => ({ choices: [{ message: { content: '{"rewritten":"removed code", "changes":[]}' } }] });
    await assert.rejects(api.callHumanize('synthetic', '`protected` text', 'readme'), e => e.category === 'integrity');
  });
  const registration = onboarding.registerConnectionHandlers({ extension: { id: 'auaggy.deslop' }, secrets });
  try {
    await check('PKCE success verifies authentication and stores only OpenRouter', async () => {
      const flow = await startAuth(); active = 'venice';
      await handler.handleUri(uri(flow.callback + '?code=synthetic-code'));
      assert.equal(await flow.result, 'synthetic-exchanged-key'); assert.equal(stores.get('deslop.openrouterApiKey'), 'synthetic-exchanged-key'); assert.equal(stores.get('deslop.veniceApiKey'), 'old-venice');
      assert.equal(posts[0].path, '/auth/keys'); assert.equal(posts[0].options.headers.Authorization, null); assert.equal(posts[0].options.body.code_challenge_method, 'S256'); assert.equal(gets[0].path, '/key');
      await handler.handleUri(uri(flow.callback + '?code=synthetic-code')); assert.equal(posts.length, 1);
    });
    await check('only one browser connection owns consent and callback at a time', async () => {
      const flow = await startAuth(); assert.equal(await auth.connectOpenRouter(), undefined);
      cancelled(); assert.equal(await flow.result, undefined);
    });
    await check('PKCE verification failure cannot replace stored key', async () => {
      getImpl = async () => { throw { status: 401 }; };
      const flow = await startAuth(); await handler.handleUri(uri(flow.callback + '?code=synthetic-code'));
      assert.equal(await flow.result, undefined); assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router');
    });
    await check('PKCE wrong route ignored then cancellation preserves key', async () => {
      const flow = await startAuth(); await handler.handleUri(uri('vscode://auaggy.deslop/connect/openrouter/wrong?code=synthetic-code'));
      assert.equal(posts.length, 0); cancelled(); assert.equal(await flow.result, undefined); assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router');
    });
    for (const query of ['error=access_denied', 'code=one&code=two', 'code=one&state=undocumented']) {
      await check(`PKCE rejects callback ${query}`, async () => {
        const flow = await startAuth(); await handler.handleUri(uri(flow.callback + '?' + query)); assert.equal(await flow.result, undefined); assert.equal(posts.length, 0); assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router');
      });
    }
    await check('PKCE concurrent replay cannot exchange twice or cancel valid exchange', async () => {
      let release; postImpl = () => new Promise(r => { release = r; }); const flow = await startAuth();
      const completion = handler.handleUri(uri(flow.callback + '?code=synthetic-code')); await tick();
      await handler.handleUri(uri(flow.callback + '?code=synthetic-code')); assert.equal(posts.length, 1);
      release({ key: 'synthetic-exchanged-key' }); await completion; assert.equal(await flow.result, 'synthetic-exchanged-key');
    });
    for (const failure of ['timeout', 'malformed', 'storage']) {
      await check(`PKCE ${failure} preserves old key`, async () => {
        if (failure === 'timeout') postImpl = async () => { throw { name: 'APIConnectionTimeoutError' }; };
        if (failure === 'malformed') postImpl = async () => ({ key: 42 });
        if (failure === 'storage') storeImpl = async () => { throw new Error('synthetic'); };
        const flow = await startAuth(); await handler.handleUri(uri(flow.callback + '?code=synthetic-code')); assert.equal(await flow.result, undefined); assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router');
      });
    }
    await check('PKCE cancellation during exchange prevents late credential storage', async () => {
      let release; postImpl = () => new Promise(r => { release = r; }); const flow = await startAuth();
      const completion = handler.handleUri(uri(flow.callback + '?code=synthetic-code')); await tick(); cancelled();
      release({ key: 'synthetic-exchanged-key' }); await completion; assert.equal(await flow.result, undefined); assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router');
    });
  } finally { registration.dispose(); }
  console.log(`${count} deterministic boundary tests passed; live provider/editor checks NOT performed.`);
  const Mocha = require('mocha');
  const path = require('node:path');
  const mocha = new Mocha({ ui: 'tdd' });
  for (const file of ['connections.test.js', 'model.test.js']) mocha.addFile(path.resolve(__dirname, '../../out/test/suite', file));
  await new Promise((resolve, reject) => mocha.run(failures => failures ? reject(new Error(`${failures} suite failures`)) : resolve()));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; });
