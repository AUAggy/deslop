#!/usr/bin/env node
/* Deliberately not an npm test hook. No default credential lookup or SecretStorage access. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const corpus = require('./corpus.cjs');

function parseArgs(args) {
  const allowed = new Set(['--live', '--acknowledge-charges', '--provider', '--model', '--key-env', '--output', '--prompt', '--preferences', '--case']);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || Object.hasOwn(options, key)) { throw new Error('Unknown or duplicate option. See evaluation/README.md.'); }
    if (['--live', '--acknowledge-charges'].includes(key)) { options[key] = true; }
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) { throw new Error('Missing option value.'); }
      options[key] = args[++i];
    }
  }
  if (!options['--live'] || !options['--acknowledge-charges']) { throw new Error('Live inference is potentially billable. Both --live and --acknowledge-charges are required. No request sent.'); }
  if (!['openrouter', 'venice'].includes(options['--provider'])) { throw new Error('Choose --provider openrouter or venice.'); }
  for (const key of ['--model', '--key-env', '--output']) {
    if (!options[key]?.trim()) { throw new Error(`Explicit ${key} required.`); }
  }
  if (options['--key-env'] !== 'DESLOP_EVALUATION_API_KEY') { throw new Error('Use a dedicated DESLOP_EVALUATION_API_KEY variable, not an existing provider credential variable.'); }
  if (!['deslop', 'clearer'].includes(options['--prompt'])) { throw new Error('Choose --prompt deslop or clearer.'); }
  if (!['off', 'punctuation', 'structure', 'both'].includes(options['--preferences'])) { throw new Error('Choose --preferences off, punctuation, structure or both.'); }
  if (options['--prompt'] === 'clearer' && options['--preferences'] !== 'off') { throw new Error('The comparison prompt requires preferences off.'); }
  if (options['--case'] && !corpus.cases.some(c => c.id === options['--case'])) { throw new Error('Unknown case ID.'); }
  return options;
}

async function main(args) {
  const options = parseArgs(args);
  console.error('LIVE: potentially billable provider requests. Synthetic corpus only. No automatic retries.');
  const outputPath = path.resolve(options['--output']);
  // Only the explicitly named, evaluation-specific variable is read, after consent.
  // OPENAI_API_KEY and the extension's real credentials are never consulted.
  const apiKey = process.env[options['--key-env']]?.trim();
  if (!apiKey || /\s/.test(apiKey)) { throw new Error('Explicit evaluation credential missing or invalid.'); }
  const { SYSTEM_PROMPT } = require('../out/prompts/system.js');
  const { MODIFIERS } = require('../out/prompts/modifiers.js');
  const { buildPreferenceInstructions } = require('../out/editorial/preferences.js');
  const { verifyProtectedRegions, stripInvisible } = require('../out/util/postCheck.js');
  const OpenAI = require('openai').default;
  const provider = options['--provider'];
  const model = options['--model'];
  const preferences = {
    preservePunctuationStyle: ['punctuation', 'both'].includes(options['--preferences']),
    preserveParagraphListStructure: ['structure', 'both'].includes(options['--preferences']),
  };
  const client = new OpenAI({ apiKey, baseURL: provider === 'venice' ? 'https://api.venice.ai/api/v1' : 'https://openrouter.ai/api/v1', maxRetries: 0 });
  // Exclusive creation prevents accidental overwrites. Results are explicit evaluation artifacts.
  const fd = fs.openSync(outputPath, 'wx', 0o600);
  try {
    for (const item of corpus.cases.filter(c => !options['--case'] || c.id === options['--case'])) {
      const preferenceInstructions = buildPreferenceInstructions(preferences);
      const system = options['--prompt'] === 'clearer'
        ? 'Make this clearer without changing its meaning. Return a JSON object with rewritten (string) and changes (array of objects with pattern and action strings).'
        : `${SYSTEM_PROMPT}\n\n${MODIFIERS[item.documentType]}${preferenceInstructions ? `\n\n${preferenceInstructions}` : ''}`;
      const record = {
        evaluationVersion: corpus.version, caseId: item.id, provider, resolvedModel: model,
        promptVariant: options['--prompt'], promptSha256: crypto.createHash('sha256').update(system).digest('hex'),
        preferences, timestamp: new Date().toISOString(), output: null, validatedOutput: null,
        status: 'pending', latencyMs: null, usage: null,
        cost: { amount: null, currency: 'USD', status: 'unavailable; obtain provider billing evidence or add a labelled estimate before sign-off' },
        reviewerFindings: { status: 'pending human review', findings: [], partialSubsets: [] },
      };
      const start = performance.now();
      try {
        const response = await client.chat.completions.create({
          model, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: `<source_text>\n${item.source}\n</source_text>` }],
        }, { timeout: 90000 });
        record.usage = response.usage ?? null;
        const parsed = JSON.parse(response.choices[0]?.message?.content ?? 'null');
        if (!parsed || typeof parsed.rewritten !== 'string' || !Array.isArray(parsed.changes)) { throw new Error('Invalid shape'); }
        record.output = parsed.rewritten;
        const issues = verifyProtectedRegions(item.source, parsed.rewritten);
        record.protectedIssues = issues;
        record.status = issues.length ? 'hard-failure-protected-content' : 'awaiting-human-review';
        record.validatedOutput = issues.length ? null : stripInvisible(parsed.rewritten).text;
      } catch {
        // Never persist raw provider errors, headers, callbacks or credentials.
        record.status = 'request-or-response-failure';
      }
      record.latencyMs = Math.round(performance.now() - start);
      fs.writeSync(fd, `${JSON.stringify(record)}\n`);
      if (record.status === 'request-or-response-failure') { break; }
    }
  } finally { fs.closeSync(fd); }
}

module.exports = { parseArgs };
if (require.main === module) {
  main(process.argv.slice(2)).catch(() => {
    console.error('Evaluation stopped. Check explicit flags, dedicated evaluation credential, new output path, compiled assets and provider availability. No raw error was logged.');
    process.exitCode = 1;
  });
}
