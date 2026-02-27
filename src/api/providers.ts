import OpenAI from 'openai';
import * as vscode from 'vscode';
import { SYSTEM_PROMPT } from '../prompts/system';
import { MODIFIERS } from '../prompts/modifiers';
import type { DocumentType, HumanizeResponse } from '../types';

export const MAX_CHARS = 4000 * 4; // ~4000 tokens at ~4 chars/token

const PROVIDER_CONFIG = {
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'x-ai/grok-4.1-fast',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/AUAggy/deslop',
      'X-Title': 'DeSlop',
    },
  },
  venice: {
    baseURL: 'https://api.venice.ai/api/v1',
    defaultModel: 'grok-41-fast',
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
    { timeout: 20000 }
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

  return parsed;
}

export async function validateApiKey(apiKey: string): Promise<'valid' | 'invalid' | 'network-error'> {
  try {
    const provider = getProviderConfig();
    const client = new OpenAI({
      apiKey,
      baseURL: provider.baseURL,
    });
    await client.chat.completions.create(
      {
        model: provider.defaultModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      },
      { timeout: 10000 }
    );
    return 'valid';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('401') || msg.includes('403') || msg.includes('invalid_api_key') || msg.includes('authentication')) {
      return 'invalid';
    }
    return 'network-error';
  }
}
