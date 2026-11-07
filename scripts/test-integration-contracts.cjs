/* Fixed synthetic request comparisons. No credentials, disk result files or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const originalLoad = Module._load;
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const corpus = require('../evaluation/corpus.cjs');
let requests = [], clients = [], records = [], rewritten;
class MockOpenAI {
  constructor(options) {
    clients.push(options);
    this.chat = { completions: { create: async (body, options) => {
      requests.push({ body, options });
      return { choices: [{ message: { content: JSON.stringify({ rewritten, changes: [null, { pattern: 'preference conflict', action: 'Synthetic explanation.' }] }) } }] };
    } } };
  }
}
const vscode = { workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback, inspect: () => undefined }) } };
const normalize = value => JSON.parse(JSON.stringify(value));
Module._load = function(id, ...args) {
  if (id === 'vscode') return vscode;
  if (id === 'openai') return MockOpenAI;
  return originalLoad.call(this, id, ...args);
};
async function main() {
  const api = require('../out/api/providers');
  const { buildPreferenceInstructions } = require('../out/editorial/preferences');
  const { readTrustedBoolean } = require('../out/commands/humanize');
  const runnerModule = { exports: {} };
  const runnerFile = path.join(root, 'evaluation/run.cjs');
  const runnerRequire = Module.createRequire(runnerFile);
  const sandbox = { module: runnerModule, exports: runnerModule.exports, __dirname: path.dirname(runnerFile),
    process: { env: { DESLOP_EVALUATION_API_KEY: 'synthetic-evaluation-only' } },
    console: { error() {} }, Buffer,
    require: id => id === 'node:fs' ? {
      openSync: (_, flags, mode) => { assert.equal(flags, 'wx'); assert.equal(mode, 0o600); return 1; },
      writeSync: (_, line) => records.push(JSON.parse(line)), closeSync() {},
    } : id === 'openai' ? { default: MockOpenAI } : runnerRequire(id),
  };
  vm.runInNewContext(fs.readFileSync(runnerFile, 'utf8'), sandbox, { filename: runnerFile });
  let count = 0;
  for (const provider of ['openrouter', 'venice']) for (const documentType of ['README', 'Docstring/Comment', 'Commit Message', 'Blog/Article']) {
    const item = corpus.cases.find(entry => entry.documentType === documentType);
    assert.ok(item);
    for (const preferencesName of ['off', 'punctuation', 'structure', 'both']) {
      requests = []; clients = []; records = [];
      rewritten = item.source + '\nSynthetic' + String.fromCodePoint(0x200b) + ' note.';
      const preferences = { preservePunctuationStyle: ['punctuation', 'both'].includes(preferencesName), preserveParagraphListStructure: ['structure', 'both'].includes(preferencesName) };
      const result = await api.callHumanize('synthetic-evaluation-only', item.source, documentType, {
        provider, model: 'synthetic-model', preferenceInstructions: buildPreferenceInstructions(preferences),
      });
      await runnerModule.exports.main(['--live', '--acknowledge-charges', '--provider', provider, '--model', 'synthetic-model',
        '--key-env', 'DESLOP_EVALUATION_API_KEY', '--output', '/synthetic/no-file-created.jsonl', '--prompt', 'deslop', '--preferences', preferencesName, '--case', item.id]);
      assert.deepEqual(normalize(requests[0]), normalize(requests[1]));
      assert.deepEqual(normalize(clients[0]), normalize(clients[1]));
      assert.equal(records[0].validatedOutput, result.rewritten);
      assert.equal(records[0].modelExplanations.length, 1);
      assert.equal(records[0].cleanup.invisibleCount, 1);
      assert.equal(clients[0].logLevel, 'off');
      if (preferencesName === 'off') assert.equal(buildPreferenceInstructions(preferences), '');
      count++;
    }
  }
  console.log(`PASS ${count} provider/evaluation comparisons: exact completion bodies, transport settings, headers, cleanup, bounded/default preference path.`);
  for (const key of ['autoAccept', 'showChangeLog']) {
    for (const globalValue of [undefined, false, true]) {
      const config = { inspect: () => ({ globalValue, workspaceValue: true, workspaceFolderValue: true, globalLanguageValue: true, defaultValue: false }) };
      assert.equal(readTrustedBoolean(config, key, false), globalValue === true);
    }
  }
  const commands = manifest.contributes.commands.map(command => command.command);
  assert.equal(new Set(commands).size, commands.length);
  const extension = fs.readFileSync(path.join(root, 'src/extension.ts'), 'utf8');
  const review = fs.readFileSync(path.join(root, 'src/ui/diff.ts'), 'utf8');
  const actionText = review.match(/const actions[^=]*= \[([\s\S]*?)\];/)[1];
  const actions = [...actionText.matchAll(/'([^']+)'/g)].map(match => match[1]);
  const registered = [...extension.matchAll(/'(deslop\.[^']+)'\s*:/g)].map(match => match[1]).concat(actions.map(action => 'deslop.review.' + action));
  assert.deepEqual(new Set(commands), new Set(registered));
  for (const entries of Object.values(manifest.contributes.menus)) for (const item of entries) assert.ok(commands.includes(item.command));
  for (const item of manifest.contributes.keybindings) assert.ok(commands.includes(item.command));
  for (const property of ['preservePunctuationStyle', 'preserveParagraphListStructure', 'rememberDocumentType']) {
    const config = manifest.contributes.configuration.properties['deslop.' + property];
    assert.equal(config.default, false); assert.equal(config.scope, 'application');
  }
  for (const menu of manifest.contributes.menus['editor/title']) assert.equal(menu.when, 'deslop.reviewActive');
  assert.ok(manifest.activationEvents.includes('onUri'));
  assert.equal(require('@types/vscode/package.json').version, '1.110.0');
  console.log('PASS explicit-global-only consent, default-off preferences, exact command/contribution coverage, scoped menus and minimum API types.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; });
