import OpenAI from 'openai';
import * as vscode from 'vscode';
import { SYSTEM_PROMPT } from '../prompts/system';
import { MODIFIERS } from '../prompts/modifiers';
import type { DocumentType, HumanizeResponse } from '../types';

export const MAX_CHARS = 4000 * 4; // ~4000 tokens at ~4 chars/token
export const HUMANIZE_TIMEOUT_MS = 90000;

const PROVIDER_CONFIG = {
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-v4-flash',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/AUAggy/deslop',
      'X-Title': 'DeSlop',
    },
  },
  venice: {
    baseURL: 'https://api.venice.ai/api/v1',
    defaultModel: 'deepseek-v4-flash',
    defaultHeaders: {},
  },
} as const;

type Provider = keyof typeof PROVIDER_CONFIG;

function getProviderConfig(): (typeof PROVIDER_CONFIG)[Provider] {
  const cfg = vscode.workspace.getConfiguration('deslop');
  const p = cfg.get<string>('provider', 'openrouter');
  return p === 'venice' ? PROVIDER_CONFIG.venice : PROVIDER_CONFIG.openrouter;
}

export function isSelectionTooLong(text: string): boolean {
  return text.length > MAX_CHARS;
}

export async function callHumanize(
  apiKey: string,
  text: string,
  docType: DocumentType
): Promise<HumanizeResponse> {
  const cfg = vscode.workspace.getConfiguration('deslop');
  const provider = getProviderConfig();
  const model = cfg.get<string>('model', provider.defaultModel);

  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseURL,
    defaultHeaders: provider.defaultHeaders,
  });

  const systemPrompt = `${SYSTEM_PROMPT}\n\n${MODIFIERS[docType]}`;

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
    { timeout: HUMANIZE_TIMEOUT_MS }
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error('Empty response from API');
  }

  let parsed: HumanizeResponse;
  try {
    parsed = JSON.parse(raw) as HumanizeResponse;
  } catch {
    throw new Error('API returned invalid JSON');
  }

  if (typeof parsed.rewritten !== 'string' || !Array.isArray(parsed.changes)) {
    throw new Error('API response missing required fields');
  }

  parsed.changes = sanitiseChanges(parsed.changes);

  return parsed;
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

export async function validateApiKey(apiKey: string): Promise<'valid' | 'invalid' | 'network-error'> {
  try {
    const cfg = vscode.workspace.getConfiguration('deslop');
    const provider = getProviderConfig();
    const model = cfg.get<string>('model', provider.defaultModel);
    const client = new OpenAI({
      apiKey,
      baseURL: provider.baseURL,
    });
    await client.chat.completions.create(
      {
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      },
      { timeout: 10000 }
    );
    return 'valid';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b401\b/.test(msg) || /\b403\b/.test(msg) || msg.includes('invalid_api_key')) {
      return 'invalid';
    }
    return 'network-error';
  }
}
