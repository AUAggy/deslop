/* Real installed SDK, synthetic responses, mocked fetch: zero provider traffic. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const originalFetch = global.fetch;
const oldLevel = process.env.OPENAI_LOG;
const originals = new Map();
const logs = [];
let callback, browser, requests = 0;
const disposable = () => ({ dispose() {} });
const parse = value => {
  const url = new URL(value);
  return { scheme: url.protocol.slice(0, -1), authority: url.host, path: url.pathname,
    query: url.search.slice(1), fragment: url.hash.slice(1), toString: () => value };
};
const vscode = {
  Disposable: class { constructor(fn) { this.dispose = fn; } },
  ProgressLocation: { Notification: 1 },
  Uri: { parse, from: x => parse(`${x.scheme}://${x.authority}${x.path}`) },
  workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback, inspect: () => undefined }) },
  env: { uriScheme: 'vscode', asExternalUri: async uri => uri, openExternal: async uri => { browser = uri; return true; } },
  window: {
    registerUriHandler: handler => { callback = handler.handleUri; return disposable(); },
    showInformationMessage: async () => 'Continue', showErrorMessage: async () => undefined,
    withProgress: async (_, run) => run({}, { onCancellationRequested: disposable }),
  },
};
async function main() {
  process.env.OPENAI_LOG = 'debug';
  for (const name of ['log', 'info', 'debug', 'warn', 'error', 'trace']) {
    originals.set(name, console[name]);
    console[name] = (...args) => logs.push(args);
  }
  global.fetch = async input => {
    requests++;
    const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
    assert.ok(['openrouter.ai', 'api.venice.ai'].includes(url.hostname));
    let body;
    if (url.pathname.endsWith('/auth/keys')) body = { key: 'synthetic-private-exchanged-key' };
    else if (url.pathname.endsWith('/chat/completions')) body = { choices: [{ message: { content: JSON.stringify({ rewritten: 'Synthetic private output.', changes: [] }) } }] };
    else body = { data: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  Module._load = function(id, ...args) {
    return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args);
  };
  const api = require('../out/api/providers');
  await api.callHumanize('synthetic-private-key', 'Synthetic private source.', 'README', { provider: 'openrouter', model: 'synthetic-model' });
  await api.verifyAuthentication('synthetic-private-key', 'venice');
  await api.testModelReadiness('synthetic-private-key', { provider: 'openrouter', model: 'synthetic-model' });
  const auth = require('../out/commands/connectionAuth');
  const registration = auth.registerConnectionHandlers({ extension: { id: 'auaggy.deslop' }, secrets: { store: async () => {} } });
  try {
    const connecting = auth.connectOpenRouter();
    for (let i = 0; i < 10 && !browser; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(browser);
    const route = new URL(browser.toString()).searchParams.get('callback_url');
    await callback(parse(route + '?code=synthetic-private-code'));
    assert.equal(await connecting, 'synthetic-private-exchanged-key');
  } finally { registration.dispose(); }
  assert.equal(requests, 5, 'all inference/metadata/readiness/exchange requests were mocked');
  assert.equal(logs.length, 0, 'SDK must emit no console output even with OPENAI_LOG=debug');
}
main().then(() => {
  originals.get('log')('PASS SDK privacy: 5 mocked fetches, zero real network requests, zero logs with OPENAI_LOG=debug.');
}).catch(() => {
  originals.get('error')('FAIL SDK privacy regression (captured log payloads deliberately not printed).');
  process.exitCode = 1;
}).finally(() => {
  for (const [name, original] of originals) console[name] = original;
  Module._load = originalLoad;
  global.fetch = originalFetch;
  if (oldLevel === undefined) delete process.env.OPENAI_LOG;
  else process.env.OPENAI_LOG = oldLevel;
});
