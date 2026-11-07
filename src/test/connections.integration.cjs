/* Deterministic Node-only boundary tests. Run after compile; no provider traffic or editor launch. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let handler, opened, gets, posts, stores, completions, info, inputs, warnings, picked, cancelled, active, getImpl, postImpl, createImpl, storeImpl, lastTitle, modelOverride;
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
  CancellationTokenSource: class { token = { isCancellationRequested: false }; cancel() { this.token.isCancellationRequested = true; } dispose() {} },
  ProgressLocation: { Notification: 15 },
  Uri: { parse: uri, from: x => uri(`${x.scheme}://${x.authority}${x.path}`) },
  workspace: { getConfiguration: () => ({ get: (key, fallback) => key === 'provider' ? active : key === 'model' ? modelOverride ?? fallback : fallback,
    inspect: () => modelOverride === undefined ? undefined : { globalValue: modelOverride } }) },
  env: { uriScheme: 'vscode', asExternalUri: async x => x, openExternal: async x => { opened = x; return true; } },
  window: {
    registerUriHandler: x => { handler = x; return disposable(); },
    showInformationMessage: async () => info.shift(),
    showErrorMessage: async () => info.shift(),
    showWarningMessage: async () => warnings.shift(),
    showInputBox: async () => inputs.shift(),
    showQuickPick: async (_, options) => { lastTitle = options?.title; return picked.shift(); },
    withProgress: async (_opts, fn) => fn({}, { isCancellationRequested: false, onCancellationRequested: fn => { cancelled = fn; return disposable(); } }),
  },
};
class FakeOpenAI {
  constructor(options) {
    assert.equal(options.maxRetries, 0);
    assert.equal(options.logLevel, 'off');
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
  getImpl = postImpl = createImpl = storeImpl = lastTitle = modelOverride = undefined;
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
  await check('manual input cancellation settles immediately and ignores a late candidate', async () => {
    const old = fakeVscode.window.showInputBox; let release, token;
    fakeVscode.window.showInputBox = (_, cancellation) => { token = cancellation; return new Promise(resolve => { release = resolve; }); };
    try {
      const controller = new AbortController();
      const setup = onboarding.promptAndSaveKey(secrets, 'openrouter', controller.signal); await tick();
      controller.abort(); assert.equal(await setup, undefined); assert.equal(token.isCancellationRequested, true);
      release('late-candidate'); await tick();
      assert.equal(gets.length, 0); assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router');
    } finally { fakeVscode.window.showInputBox = old; }
  });
  await check('Get Key cancellation settles while browser-open is pending, without late continuation UI', async () => {
    const old = fakeVscode.env.openExternal; let release;
    fakeVscode.env.openExternal = () => new Promise(resolve => { release = resolve; });
    try {
      stores.delete('deslop.veniceApiKey'); info.push('Get Key', 'Enter Key');
      const controller = new AbortController(); const setup = onboarding.ensureApiKey(secrets, 'venice', controller.signal); await tick();
      controller.abort(); assert.equal(await setup, undefined);
      release(true); await tick(); assert.deepEqual(info, ['Enter Key']); assert.equal(gets.length, 0);
    } finally { fakeVscode.env.openExternal = old; }
  });
  await check('model test requires charge consent', async () => {
    picked.push('Test Model Readiness (may incur charges)'); await onboarding.manageConnection(secrets, 'openrouter'); assert.equal(completions.length, 0);
    picked.push('Test Model Readiness (may incur charges)'); warnings.push('Run Test'); await onboarding.manageConnection(secrets, 'openrouter'); assert.equal(completions.length, 1);
  });
  await check('inference captures provider/model/signal and bounded preferences', async () => {
    active = 'venice'; const controller = new AbortController();
    await api.callHumanize('synthetic', 'Clear text.', 'README', { provider: 'openrouter', model: 'captured-model', signal: controller.signal, preferenceInstructions: 'Preserve paragraph and list organisation where possible; meaning takes priority.' });
    assert.equal(completions[0].client.baseURL, 'https://openrouter.ai/api/v1'); assert.equal(completions[0].body.model, 'captured-model'); assert.equal(completions[0].options.signal, controller.signal);
    assert.match(completions[0].body.messages[0].content, /Preserve paragraph/);
  });
  await check('disabled preferences preserve the original system prompt exactly', async () => {
    const { SYSTEM_PROMPT } = require('../../out/prompts/system'); const { MODIFIERS } = require('../../out/prompts/modifiers');
    await api.callHumanize('synthetic', 'Clear text.', 'README', { provider: 'openrouter', model: 'captured', preferenceInstructions: '' });
    assert.equal(completions[0].body.messages[0].content, `${SYSTEM_PROMPT}\n\n${MODIFIERS.README}`);
  });
  await check('abort before inference and oversized instructions make no request', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.callHumanize('synthetic', 'Text', 'README', { provider: 'openrouter', model: 'captured', signal: controller.signal }), e => e.category === 'cancelled');
    await assert.rejects(api.callHumanize('synthetic', 'Text', 'README', { provider: 'openrouter', model: 'captured', preferenceInstructions: 'x'.repeat(2001) }), e => e.category === 'malformed');
    assert.equal(completions.length, 0);
  });
  await check('late cancelled response is rejected', async () => {
    const controller = new AbortController(); createImpl = async () => { controller.abort(); return { choices: [{ message: { content: '{"rewritten":"Clear text.","changes":[]}' } }] }; };
    await assert.rejects(api.callHumanize('synthetic', 'Clear text.', 'README', { provider: 'openrouter', model: 'captured', signal: controller.signal }), e => e.category === 'cancelled');
  });
  await check('malformed response and integrity failure remain distinct', async () => {
    createImpl = async () => ({ choices: [{ message: { content: 'null' } }] });
    await assert.rejects(api.callHumanize('synthetic', 'Text', 'README'), e => e.category === 'malformed');
    createImpl = async () => ({ choices: [{ message: { content: '{"rewritten":"removed code", "changes":[]}' } }] });
    await assert.rejects(api.callHumanize('synthetic', '`protected` text', 'README'), e => e.category === 'integrity');
  });
  for (const envelope of [null, {}, { choices: [] }, { error: { code: 503 } }, { choices: [{ message: { content: '' } }] }]) {
    await check('malformed inference and readiness envelopes fail closed: ' + JSON.stringify(envelope), async () => {
      createImpl = async () => envelope;
      await assert.rejects(api.callHumanize('synthetic', 'Text', 'README'), e => e.category === 'malformed');
      await assert.rejects(api.testModelReadiness('synthetic', { provider: 'openrouter', model: 'captured' }), e => e.category === 'malformed');
    });
  }
  await check('confirmed disconnect invalidates older pending manual verification', async () => {
    let release;
    inputs.push('older-candidate'); getImpl = () => new Promise(resolve => { release = resolve; });
    const replacing = onboarding.promptAndSaveKey(secrets, 'openrouter'); await tick();
    warnings.push('Disconnect'); await onboarding.disconnectProvider(secrets, 'openrouter');
    release({ data: {} });
    assert.equal(await replacing, undefined);
    assert.equal(stores.has('deslop.openrouterApiKey'), false);
  });
  let registration = onboarding.registerConnectionHandlers({ extension: { id: 'auaggy.deslop' }, secrets });
  try {
    await check('late test of a replaced credential cannot report current authentication success', async () => {
      let release;
      getImpl = () => new Promise(resolve => { release = resolve; });
      picked.push('Test Authentication');
      const testing = onboarding.manageConnection(secrets, 'openrouter'); await tick();
      getImpl = async () => ({ data: {} }); inputs.push('newer-candidate');
      await onboarding.promptAndSaveKey(secrets, 'openrouter');
      release({ data: {} }); await testing;
      await onboarding.manageConnection(secrets, 'openrouter');
      assert.match(lastTitle, /not tested/);
    });
    await check('model readiness status names its tested model and does not follow model setting drift', async () => {
      picked.push('Test Model Readiness (may incur charges)'); warnings.push('Run Test');
      await onboarding.manageConnection(secrets, 'openrouter');
      await onboarding.manageConnection(secrets, 'openrouter');
      assert.match(lastTitle, /model openai\/gpt-6-luna responded at/);
      modelOverride = 'new-model';
      await onboarding.manageConnection(secrets, 'openrouter');
      assert.match(lastTitle, /not tested/);
    });
    await check('PKCE success verifies authentication and stores only OpenRouter', async () => {
      const flow = await startAuth(); active = 'venice';
      await handler.handleUri(uri(flow.callback + '?code=synthetic-code'));
      assert.equal(await flow.result, 'synthetic-exchanged-key'); assert.equal(stores.get('deslop.openrouterApiKey'), 'synthetic-exchanged-key'); assert.equal(stores.get('deslop.veniceApiKey'), 'old-venice');
      assert.equal(posts[0].path, '/auth/keys'); assert.equal(posts[0].options.headers.Authorization, null); assert.equal(posts[0].options.body.code_challenge_method, 'S256'); assert.equal(gets[0].path, '/key');
      await handler.handleUri(uri(flow.callback + '?code=synthetic-code')); assert.equal(posts.length, 1);
    });
    await check('abort before deferred progress callback does not route or open the browser', async () => {
      const oldProgress = fakeVscode.window.withProgress;
      const oldRoute = fakeVscode.env.asExternalUri;
      let startTask, routed = false;
      fakeVscode.window.withProgress = (options, run) => options.title.startsWith('Waiting for OpenRouter')
        ? new Promise((resolve, reject) => { startTask = () => Promise.resolve(run({}, { isCancellationRequested: false, onCancellationRequested: fn => { cancelled = fn; return disposable(); } })).then(resolve, reject); })
        : oldProgress(options, run);
      fakeVscode.env.asExternalUri = value => { routed = true; return Promise.resolve(value); };
      try {
        const controller = new AbortController(); info.push('Continue');
        const flow = auth.connectOpenRouter(controller.signal); await tick();
        assert.ok(startTask, 'progress task deferred');
        controller.abort();
        startTask(); await tick();
        assert.equal(routed, false, 'aborted task must not begin routing');
        assert.equal(opened, undefined, 'aborted task must not open the browser');
        assert.equal(await flow, undefined);
      } finally { fakeVscode.window.withProgress = oldProgress; fakeVscode.env.asExternalUri = oldRoute; }
      const next = await startAuth(); cancelled(); assert.equal(await next.result, undefined);
    });
    await check('dispose before deferred progress callback cannot route or open the browser', async () => {
      const oldProgress = fakeVscode.window.withProgress;
      const oldRoute = fakeVscode.env.asExternalUri;
      let startTask, routed = false;
      fakeVscode.window.withProgress = (options, run) => options.title.startsWith('Waiting for OpenRouter')
        ? new Promise((resolve, reject) => { startTask = () => Promise.resolve(run({}, { isCancellationRequested: false, onCancellationRequested: fn => { cancelled = fn; return disposable(); } })).then(resolve, reject); })
        : oldProgress(options, run);
      fakeVscode.env.asExternalUri = value => { routed = true; return Promise.resolve(value); };
      try {
        info.push('Continue'); const flow = auth.connectOpenRouter(); await tick();
        assert.ok(startTask);
        registration.dispose();
        startTask(); await tick();
        assert.equal(routed, false, 'disposed task must not begin routing');
        assert.equal(opened, undefined, 'disposed task must not open the browser');
        assert.equal(await flow, undefined);
      } finally {
        fakeVscode.window.withProgress = oldProgress; fakeVscode.env.asExternalUri = oldRoute;
        registration = onboarding.registerConnectionHandlers({ extension: { id: 'auaggy.deslop' }, secrets });
      }
      cancelled();
    });
    await check('abort during browser consent releases ownership and ignores late Continue', async () => {
      const old = fakeVscode.window.showInformationMessage; let release;
      fakeVscode.window.showInformationMessage = () => new Promise(resolve => { release = resolve; });
      const controller = new AbortController();
      try {
        const pendingConsent = auth.connectOpenRouter(controller.signal); await tick();
        controller.abort(); assert.equal(await pendingConsent, undefined);
        release('Continue'); await tick(); assert.equal(opened, undefined);
      } finally { fakeVscode.window.showInformationMessage = old; }
      const next = await startAuth(); cancelled(); assert.equal(await next.result, undefined);
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
    await check('cancelled PKCE submitted store cannot overwrite a newer manual replacement', async () => {
      let release;
      storeImpl = () => new Promise(resolve => { release = resolve; });
      const flow = await startAuth();
      const completion = handler.handleUri(uri(flow.callback + '?code=synthetic-code')); await tick();
      assert.ok(release, 'old store was submitted');
      cancelled(); assert.equal(await flow.result, undefined);
      storeImpl = undefined; inputs.push('newer-manual-key');
      const replacement = onboarding.promptAndSaveKey(secrets, 'openrouter'); await tick();
      assert.equal(stores.get('deslop.openrouterApiKey'), 'old-router');
      release(); await completion;
      assert.equal(await replacement, 'newer-manual-key');
      assert.equal(stores.get('deslop.openrouterApiKey'), 'newer-manual-key');
    });
    for (const boundary of ['asExternalUri', 'openExternal']) {
      await check('PKCE cancellation releases pending ' + boundary + ' and ignores late routing', async () => {
        const original = fakeVscode.env[boundary]; let release;
        fakeVscode.env[boundary] = value => new Promise(resolve => { release = () => resolve(boundary === 'asExternalUri' ? value : true); });
        try {
          info.push('Continue'); const flow = auth.connectOpenRouter(); await tick();
          cancelled(); assert.equal(await flow, undefined);
          release(); await tick();
          if (boundary === 'asExternalUri') assert.equal(opened, undefined, 'cancelled route cannot launch browser');
        } finally { fakeVscode.env[boundary] = original; }
        const next = await startAuth(); cancelled(); assert.equal(await next.result, undefined);
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
