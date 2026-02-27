import OpenAI from 'openai';
import * as vscode from 'vscode';
import { SYSTEM_PROMPT } from '../prompts/system';
import { MODIFIERS } from '../prompts/modifiers';
import type { DocumentType, HumanizeResponse } from '../types';

const MAX_CHARS = 4000 * 4; // ~4000 tokens at ~4 chars/token

export function isSelectionTooLong(text: string): boolean {
  return text.length > MAX_CHARS;
}

export async function callHumanize(
  apiKey: string,
  text: string,
  docType: DocumentType
): Promise<HumanizeResponse> {
  const config = vscode.workspace.getConfiguration('deslop');
  const model = config.get<string>('model', 'x-ai/grok-4.1-fast');

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/miaggy/deslop',
      'X-Title': 'DeSlop',
    },
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
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    await client.chat.completions.create(
      {
        model: 'x-ai/grok-4.1-fast',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      },
      { timeout: 10000 }
    );
    return 'valid';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Auth failures have 401 or 403 in the message/status
    if (msg.includes('401') || msg.includes('403') || msg.includes('invalid_api_key') || msg.includes('authentication')) {
      return 'invalid';
    }
    // Everything else (network timeout, DNS, 5xx) is a connectivity issue
    return 'network-error';
  }
}
