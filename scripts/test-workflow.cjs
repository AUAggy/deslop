/* Deterministic orchestration checks. No editor process, credentials or network. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const mocks = ['vscode', './onboarding', '../api/providers', '../api/errors', '../ui/diff', '../ui/changelog',
  '../util/isProseSelection', '../editorial/settings'];
const { build } = require('esbuild');
let api;
let state;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); } };
const response = { rewritten: 'Clear prose.', changes: [{ pattern: 'padding', action: 'Removed padding.' }] };

function reset() {
  api?.disposeWorkflow();
  state = { requests: [], reviews: [], errors: [], warnings: [], infos: [], clipboard: [], logs: [],
    edits: [], applied: true, typePicks: 0, provider: 'openrouter', model: 'captured-model',
    prefs: { preservePunctuationStyle: false, preserveParagraphListStructure: false },
    autoAccept: false, key: 'synthetic-key', review: deferred(), request: undefined, errorActions: [] };
  state.document = { version: 1, isClosed: false, fileName: '/synthetic/README.md', languageId: 'markdown', getText: () => state.text };
  state.text = 'Padded prose.';
  state.editor = { document: state.document, selection: { start: 0, end: 13, isEmpty: false },
    edit: async (callback, options) => {
      const version = state.document.version;
      callback({ replace: (range, text) => state.edits.push({ range, text, options }) });
      return state.applied && version === state.document.version;
    } };
  state.context = { secrets: {}, globalState: { get: () => undefined, update: async () => {} } };
}

const proxy = name => `module.exports = globalThis.__deslopWorkflowMocks[${JSON.stringify(name)}];`;
async function load() {
  globalThis.__deslopWorkflowMocks = {
    vscode: {
      Range: class { constructor(start, end) { this.start = start; this.end = end; } },
      Selection: class { constructor(start, end) { this.start = start; this.end = end; } },
      ProgressLocation: { Notification: 15 },
      workspace: { getConfiguration: () => ({ get: key => key === 'defaultDocumentType' ? null : undefined,
        inspect: key => ({ defaultValue: false, globalValue: key === 'autoAccept' ? state.autoAccept : false }) }) },
      commands: { executeCommand: async () => {} },
      env: { clipboard: { writeText: async text => state.clipboard.push(text) } },
      window: {
        get activeTextEditor() { return state.editor; },
        showQuickPick: async () => { state.typePicks++; return undefined; },
        showInputBox: async options => { state.lastInput = options; return state.newModel; },
        showInformationMessage: async (message) => { state.infos.push(message); return state.infoAction; },
        showWarningMessage: async (message) => { state.warnings.push(message); return state.warningAction; },
        showErrorMessage: async (message) => { state.errors.push(message); return state.errorActions.shift(); },
        withProgress: async (_, callback) => callback({ report() {} }, { onCancellationRequested: callback => {
          state.cancelProgress = callback; return { dispose() {} };
        } }),
      },
    },
    './onboarding': {
      ensureApiKey: async (_, provider, signal) => {
        state.setupProvider = provider;
        state.setupSignal = signal;
        return state.setup ? state.setup.promise : state.key;
      }, promptAndSaveKey: async () => {}, manageConnection: async () => {},
    },
    '../api/providers': {
      captureRequestOptions: () => ({ provider: state.provider, model: state.model }),
      isSelectionTooLong: text => text.length > 16000,
      callHumanize: async (key, text, type, options) => {
        state.requests.push({ key, text, type, options });
        if (state.failures > 0) { state.failures--; throw new Error('SENSITIVE REMOTE PAYLOAD'); }
        return state.request ? state.request.promise : response;
      },
    },
    '../api/errors': { classifyProviderError: () => ({ message: 'Sanitised failure.', category: 'unknown' }) },
    '../ui/diff': {
      showReview: async request => { state.reviews.push(request); return state.review.promise; },
      cancelReview: () => state?.review.resolve({ kind: 'discard' }), returnToReview: async () => {},
    },
    '../ui/changelog': { logChanges: (...args) => state.logs.push(args) },
    '../util/isProseSelection': { isProseSelection: async () => true, isCodeCommentSelection: async () => false },
    '../editorial/settings': {
      readEditorialPreferences: () => state.prefs,
      readRememberDocumentType: () => false,
      configureEditorialPreferences: async () => false,
    },
  };
  const result = await build({ entryPoints: ['src/commands/humanize.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'workflow-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => mocks.includes(args.path) ? { path: args.path, namespace: 'workflow-test' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'workflow-test' }, args => ({ contents: proxy(args.path), loader: 'js' }));
    } }],
  });
  const filename = path.join(process.cwd(), 'workflow-test-bundle.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded._compile(result.outputFiles[0].text, filename);
  api = loaded.exports;
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
const start = () => api.humanizeSelection(state.context);
const accept = async (text = response.rewritten) => {
  state.review.resolve({ kind: 'apply', text, summary: { selectedGroupIds: ['g1'], totalGroups: 1, selectedGroups: 1, fullRewrite: true } });
  await settle();
};

test('unchanged validated output opens no review and performs no edit', async () => {
  state.request = { promise: Promise.resolve({ rewritten: state.text, changes: [] }) };
  await start();
  assert.equal(state.reviews.length, 0);
  assert.equal(state.edits.length, 0);
  assert.ok(state.infos.includes('No changes needed.'));
});

test('second invocation cannot overlap setup or inference', async () => {
  state.setup = deferred();
  const run = start(); await settle();
  await start();
  assert.equal(state.requests.length, 0);
  state.setup.resolve('synthetic-key'); await settle();
  await start();
  assert.equal(state.requests.length, 1);
  api.cancelOperation(); await run;
  assert.equal(state.edits.length, 0);
});

test('setup resumes original selection with captured provider and choices', async () => {
  state.setup = deferred();
  const run = start(); await settle();
  state.provider = 'venice'; state.model = 'changed-model';
  state.prefs.preservePunctuationStyle = true;
  state.setup.resolve('synthetic-key'); await settle();
  const request = state.requests[0];
  assert.equal(request.options.provider, 'openrouter');
  assert.equal(request.options.model, 'captured-model');
  assert.equal(request.options.preferenceInstructions, '');
  assert.equal(state.reviews[0].metadata.preferences.preservePunctuationStyle, false);
  assert.equal(state.typePicks, 0);
  api.cancelOperation(); await run;
});

test('cancelled setup never sends a request', async () => {
  state.setup = deferred(); const run = start(); await settle();
  api.cancelOperation(); state.setup.resolve('synthetic-key'); await run;
  assert.equal(state.requests.length, 0);
  assert.ok(state.setupSignal.aborted);
});

test('source mutation during setup blocks inference', async () => {
  state.setup = deferred(); const run = start(); await settle();
  state.document.version++; state.setup.resolve('synthetic-key'); await run;
  assert.equal(state.requests.length, 0);
  assert.equal(state.edits.length, 0);
});

test('progress cancellation aborts SDK signal and ignores late completion', async () => {
  state.request = deferred(); const run = start(); await settle();
  state.cancelProgress(); state.request.resolve(response); await run;
  assert.ok(state.requests[0].options.signal.aborted);
  assert.equal(state.reviews.length, 0);
  assert.equal(state.edits.length, 0);
});

test('old cancellation callbacks cannot cancel a newer operation', async () => {
  state.request = deferred(); const oldRequest = state.request;
  const first = start(); await settle();
  const oldCancel = state.cancelProgress;
  api.cancelOperation();
  state.request = undefined; state.review = deferred();
  const second = start(); await settle();
  oldCancel();
  assert.equal(state.requests[1].options.signal.aborted, false);
  oldRequest.resolve(response); await first;
  assert.equal(state.reviews.length, 1);
  api.cancelOperation(); await second;
});

test('Retry is bounded and retains source/type/model/preferences', async () => {
  state.failures = 10; state.errorActions = ['Retry', 'Retry', 'Retry'];
  await start();
  assert.equal(state.requests.length, 3);
  assert.equal(state.typePicks, 0);
  assert.deepEqual(state.requests[0].options, state.requests[2].options);
  assert.ok(state.errors.every(message => !message.includes('SENSITIVE')));
});

test('Retry checks freshness before sending another request', async () => {
  state.failures = 1; state.errorActions = ['Retry'];
  const showError = globalThis.__deslopWorkflowMocks.vscode.window.showErrorMessage;
  globalThis.__deslopWorkflowMocks.vscode.window.showErrorMessage = async (...args) => {
    state.document.version++; return showError(...args);
  };
  try { await start(); } finally { globalThis.__deslopWorkflowMocks.vscode.window.showErrorMessage = showError; }
  assert.equal(state.requests.length, 1);
  assert.equal(state.edits.length, 0);
});

test('discard/closed review settles operation and permits next invocation', async () => {
  const run = start(); await settle(); state.review.resolve({ kind: 'discard' }); await run;
  assert.equal(state.edits.length, 0);
  state.review = deferred(); const next = start(); await settle();
  assert.equal(state.requests.length, 2); api.cancelOperation(); await next;
});

for (const mutation of ['version', 'closure']) {
  test(`${mutation} before acceptance blocks application, retains explicit Copy Result`, async () => {
    const run = start(); await settle();
    if (mutation === 'version') { state.document.version++; } else { state.document.isClosed = true; }
    await accept(); await run;
    assert.equal(state.edits.length, 0);
    assert.equal(state.clipboard.length, 0);
    await api.copyResult(); assert.deepEqual(state.clipboard, [response.rewritten]);
  });
}

test('tab switching still applies to captured editor as one undoable edit', async () => {
  const run = start(); await settle();
  state.editor = { document: { version: 9 }, edit: () => { throw new Error('Wrong target'); } };
  await accept(); await run;
  assert.equal(state.edits.length, 1);
  assert.deepEqual(state.edits[0].options, { undoStopBefore: true, undoStopAfter: true });
  assert.equal(state.logs.length, 1);
});

test('failed edit is not announced as success and retains the exact composed result', async () => {
  state.applied = false; const run = start(); await settle();
  await accept('Partially clear prose.'); await run;
  assert.equal(state.logs.length, 0);
  assert.ok(!state.infos.some(message => message.startsWith('Rewrite applied')));
  await api.copyResult(); assert.deepEqual(state.clipboard, ['Partially clear prose.']);
});

test('none selected performs no source edit and no application announcement', async () => {
  const run = start(); await settle(); await accept(state.text); await run;
  assert.equal(state.edits.length, 0);
  assert.equal(state.logs.length, 0);
});

test('unsafe composed protected-content changes are blocked again before edit', async () => {
  state.text = 'Original `identifier` prose.';
  const run = start(); await settle(); await accept('Changed `other` prose.'); await run;
  assert.equal(state.edits.length, 0);
  assert.ok(state.warnings.some(message => message.includes('output-integrity')));
});

test('composed output requiring invisible-character cleanup cannot silently change before edit', async () => {
  const run = start(); await settle(); await accept(`Clear${String.fromCodePoint(0x200b)} prose.`); await run;
  assert.equal(state.edits.length, 0);
  assert.ok(state.warnings.some(message => message.includes('output-integrity')));
});

test('captured user auto-accept remains an explicit full-rewrite choice', async () => {
  state.autoAccept = true; await start();
  assert.equal(state.reviews.length, 0);
  assert.equal(state.edits.length, 1);
});

test('cancelled regeneration consent does not invalidate the pending review', async () => {
  const run = start(); await settle();
  state.newModel = 'revised-model'; await api.changeModel();
  assert.equal(state.requests.length, 1);
  await accept(); await run;
  assert.equal(state.edits.length, 1);
});

test('dismissed regeneration failure retains prior completed result', async () => {
  const run = start(); await settle();
  state.newModel = 'revised-model'; state.warningAction = 'Regenerate'; state.failures = 1;
  await api.changeModel(); await run;
  await api.copyResult(); assert.deepEqual(state.clipboard, [response.rewritten]);
});

test('failed explicit regeneration retains prior result and request metadata', async () => {
  const run = start(); await settle();
  state.newModel = 'revised-model'; state.warningAction = 'Regenerate';
  state.failures = 1; state.errorActions = ['Keep Result'];
  await api.changeModel(); await run;
  assert.equal(state.requests.length, 2);
  assert.equal(state.requests[1].options.model, 'revised-model');
  state.newModel = undefined;
  await api.changeModel();
  assert.equal(state.lastInput.value, 'captured-model');
  await api.copyResult(); assert.deepEqual(state.clipboard, [response.rewritten]);
});

(async () => {
  await load();
  for (const { name, run } of tests) {
    reset();
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}`); throw error; }
  }
  api.disposeWorkflow();
  delete globalThis.__deslopWorkflowMocks;
  console.log(`${tests.length} deterministic workflow checks passed. Native editor/browser/undo behavior remains unverified.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
