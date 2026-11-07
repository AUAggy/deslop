import OpenAI from 'openai';
import { ProviderError, classifyProviderError } from './errors';
import * as vscode from 'vscode';
import { SYSTEM_PROMPT } from '../prompts/system';
import { MODIFIERS } from '../prompts/modifiers';
import { verifyProtectedRegions, stripInvisible } from '../util/postCheck';
import type { DocumentType, HumanizeResponse } from '../types';

export const MAX_CHARS = 4000 * 4; // ~4000 tokens at ~4 chars/token
export const HUMANIZE_TIMEOUT_MS = 90000;

const PROVIDER_CONFIG = {
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-6-luna',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/AUAggy/deslop',
      'X-Title': 'DeSlop',
    },
  },
  venice: {
    baseURL: 'https://api.venice.ai/api/v1',
    defaultModel: 'openai-gpt-6-luna',
    defaultHeaders: {},
  },
} as const;

export type Provider = keyof typeof PROVIDER_CONFIG;

export function activeProvider(): Provider {
  return vscode.workspace.getConfiguration('deslop').get<string>('provider', 'openrouter') === 'venice' ? 'venice' : 'openrouter';
}
export interface RequestOptions {
  readonly provider: Provider;
  readonly model: string;
  readonly signal?: AbortSignal;
  /** Captured output of editorial.buildPreferenceInstructions only; never read free-form settings. */
  readonly preferenceInstructions?: string;
}
export function captureRequestOptions(provider: Provider = activeProvider()): RequestOptions {
  return { provider, model: resolveModel(vscode.workspace.getConfiguration('deslop'), PROVIDER_CONFIG[provider].defaultModel) };
}

export function resolveModel(cfg: vscode.WorkspaceConfiguration, defaultModel: string): string {
  const setting = cfg.inspect<string>('model');
  const hasOverride = setting && [
    setting.globalValue,
    setting.workspaceValue,
    setting.workspaceFolderValue,
    setting.globalLanguageValue,
    setting.workspaceLanguageValue,
    setting.workspaceFolderLanguageValue,
  ].some(value => value !== undefined);
  return hasOverride ? cfg.get<string>('model', defaultModel) : defaultModel;
}

export function isSelectionTooLong(text: string): boolean {
  return text.length > MAX_CHARS;
}

export async function callHumanize(
  apiKey: string,
  text: string,
  docType: DocumentType,
  options: RequestOptions = captureRequestOptions()
): Promise<HumanizeResponse> {
  try {
  const provider = PROVIDER_CONFIG[options.provider];
  const model = options.model;
  if (options.signal?.aborted) { throw new ProviderError('cancelled'); }

  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseURL,
    defaultHeaders: provider.defaultHeaders,
    maxRetries: 0,
  });

  const instructions = options.preferenceInstructions ?? '';
  if (instructions.length > 2000) { throw new ProviderError('malformed'); }
  const systemPrompt = `${SYSTEM_PROMPT}\n\n${MODIFIERS[docType]}` + (instructions ? `\n\n${instructions}` : '');

  const response = await client.chat.completions.create(
    {
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `<source_text>\n${text}\n</source_text>`,
        },
      ],
    },
    { timeout: HUMANIZE_TIMEOUT_MS, signal: options.signal }
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new ProviderError('malformed');
  }

  let parsed: HumanizeResponse;
  try {
    parsed = JSON.parse(raw) as HumanizeResponse;
  } catch {
    throw new ProviderError('malformed');
  }

  if (!parsed || typeof parsed.rewritten !== 'string' || !Array.isArray(parsed.changes)) {
    throw new ProviderError('malformed');
  }

  parsed.changes = sanitiseChanges(parsed.changes);

  const protectedIssues = verifyProtectedRegions(text, parsed.rewritten);
  if (protectedIssues.length > 0) {
    throw new ProviderError('integrity');
  }

  // Output integrity guard: strip invisible Unicode and normalise confusable
  // punctuation outside protected regions. Absolute, not a diff -- marks
  // already present in the user's selection are cleared too. Runs after
  // verifyProtectedRegions so tamper detection sees unmodified model output.
  // Never strips silently: change entries are appended in code, not by the model.
  const stripped = stripInvisible(parsed.rewritten);
  if (stripped.invisibleCount > 0) {
    parsed.changes.push({
      pattern: 'invisible characters',
      action: `Removed or normalised ${stripped.invisibleCount} invisible character(s) in the rewrite.`,
    });
  }
  if (stripped.confusableCount > 0) {
    parsed.changes.push({
      pattern: 'confusable punctuation',
      action: `Normalised ${stripped.confusableCount} look-alike punctuation character(s) to ASCII.`,
    });
  }
  parsed.rewritten = stripped.text;

  if (options.signal?.aborted) { throw new ProviderError('cancelled'); }
  return parsed;
  } catch (error) {
    throw classifyProviderError(error);
  }
}

export function sanitiseChanges(raw: unknown[]): { pattern: string; action: string }[] {
  if (!Array.isArray(raw)) { return []; }
  return raw.filter(
    (c): c is { pattern: string; action: string } =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as { pattern?: unknown }).pattern === 'string' &&
      typeof (c as { action?: unknown }).action === 'string'
  );
}

export async function verifyAuthentication(apiKey: string, provider: Provider, signal?: AbortSignal): Promise<void> {
  const client = new OpenAI({ apiKey, baseURL: PROVIDER_CONFIG[provider].baseURL, maxRetries: 0 });
  try {
    // These authenticated metadata endpoints make no completion request.
    const response = await client.get<{ data?: unknown }>(provider === 'openrouter' ? '/key' : '/api_keys/rate_limits', { timeout: 10000, signal });
    if (!response || !response.data || typeof response.data !== 'object') { throw new ProviderError('malformed'); }
  } catch (error) { throw classifyProviderError(error); }
}

export async function testModelReadiness(apiKey: string, options: RequestOptions): Promise<void> {
  const client = new OpenAI({ apiKey, baseURL: PROVIDER_CONFIG[options.provider].baseURL, maxRetries: 0 });
  try {
    await client.chat.completions.create({ model: options.model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply OK.' }] }, { timeout: 10000, signal: options.signal });
  } catch (error) { throw classifyProviderError(error); }
}

/** Compatibility wrapper; new UI uses verifyAuthentication for precise failures. */
export async function validateApiKey(apiKey: string, provider: Provider = activeProvider()): Promise<'valid' | 'invalid' | 'network-error'> {
  try { await verifyAuthentication(apiKey, provider); return 'valid'; }
  catch (error) { return classifyProviderError(error).category === 'authentication' ? 'invalid' : 'network-error'; }
}
