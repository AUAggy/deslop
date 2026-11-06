const { test } = require('node:test');
const assert = require('node:assert/strict');
const corpus = require('./corpus.cjs');
const { parseArgs } = require('./run.cjs');

test('36 permission-cleared cases have stable unique IDs, types and review metadata', () => {
  assert.equal(corpus.version, 'editorial-v1');
  assert.equal(corpus.cases.length, 36);
  assert.equal(new Set(corpus.cases.map(c => c.id)).size, 36);
  for (const item of corpus.cases) {
    assert.ok(['README', 'Docstring/Comment', 'Commit Message', 'Blog/Article'].includes(item.documentType));
    for (const field of ['id', 'category', 'source', 'provenance', 'permission', 'reviewerExpectations']) {
      assert.equal(typeof item[field], 'string');
      assert.ok(item[field].length > 0);
    }
    assert.ok(item.permission.includes('MIT'));
    assert.ok(item.requiredInvariants.length);
    for (const invariant of item.requiredInvariants) { assert.ok(item.source.includes(invariant), `${item.id}: ${invariant}`); }
  }
  for (const category of ['clean', 'qualification', 'numbers', 'accurate-vocabulary', 'protected', 'identifiers', 'unsupported-claim', 'voice', 'structure']) {
    assert.ok(corpus.cases.some(c => c.category === category));
  }
});

const valid = ['--live', '--acknowledge-charges', '--provider', 'openrouter', '--model', 'explicit-model', '--key-env', 'DESLOP_EVALUATION_API_KEY', '--output', '/not/written/by/parser', '--prompt', 'deslop', '--preferences', 'off'];

test('live runner requires explicit acknowledgement, provider, model, dedicated credential and output', () => {
  assert.throws(() => parseArgs([]), /potentially billable/);
  for (const flag of ['--live', '--acknowledge-charges']) {
    assert.throws(() => parseArgs(valid.filter(arg => arg !== flag)));
  }
  for (const flag of ['--provider', '--model', '--key-env', '--output', '--prompt', '--preferences']) {
    const index = valid.indexOf(flag);
    assert.throws(() => parseArgs(valid.filter((_, i) => i !== index && i !== index + 1)));
  }
  assert.equal(parseArgs(valid)['--provider'], 'openrouter');
});

test('runner refuses unknown/duplicate options, invalid cases and preference comparison drift', () => {
  assert.throws(() => parseArgs([...valid, '--provider', 'venice']));
  assert.throws(() => parseArgs([...valid, '--use-env']));
  assert.throws(() => parseArgs(valid.map(arg => arg === 'DESLOP_EVALUATION_API_KEY' ? 'OPENAI_API_KEY' : arg)));
  assert.throws(() => parseArgs([...valid, '--case', 'missing']));
  assert.throws(() => parseArgs(valid.map(arg => arg === 'deslop' ? 'clearer' : arg === 'off' ? 'both' : arg)));
  assert.equal(parseArgs([...valid, '--case', 'clean-readme'])['--case'], 'clean-readme');
});
