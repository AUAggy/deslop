export type ErrorCategory = 'authentication' | 'credit' | 'rate-limit' | 'model' | 'permission' | 'network' | 'timeout' | 'cancelled' | 'malformed' | 'integrity' | 'unknown';
const MESSAGES: Record<ErrorCategory, string> = {
  authentication: 'The provider rejected this credential. Replace the key.',
  credit: 'The provider reports insufficient credit. Check your provider account.',
  'rate-limit': 'The provider rate limit was reached. Wait before retrying.',
  model: 'The requested model is unavailable or not authorised. Check the model setting.',
  permission: 'The provider refused this request. Check account permissions; this does not establish that the key is invalid.',
  network: 'The provider could not be reached. Check your connection and retry.',
  timeout: 'The provider request timed out. Usage charges may still apply.',
  cancelled: 'Request cancelled. Provider usage charges may still apply.',
  malformed: 'The provider returned an unsupported response. Retry explicitly.',
  integrity: 'The rewrite changed protected content and was blocked.',
  unknown: 'The provider request failed. Check your account or retry explicitly.',
};
export type RecoveryAction = 'Replace Key' | 'Open Provider Account' | 'Change Model' | 'Retry';
export class ProviderError extends Error {
  readonly actions: readonly RecoveryAction[];
  /** Optional safe static detail replacing the generic category message; never carries raw payloads or values. */
  constructor(public readonly category: ErrorCategory, public readonly status?: number, detail?: string) {
    super(detail ?? MESSAGES[category]);
    this.name = 'ProviderError';
    this.actions = category === 'authentication' ? ['Replace Key', 'Open Provider Account']
      : category === 'credit' || category === 'permission' ? ['Open Provider Account']
      : category === 'model' ? ['Change Model', 'Open Provider Account']
      : category === 'cancelled' ? [] : ['Retry'];
  }
}
/** Never retain raw messages, payloads, request text, URLs, or headers. */
export function classifyProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) { return error; }
  const e = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown; name?: unknown } : {};
  const status = typeof e.status === 'number' && Number.isInteger(e.status) && e.status >= 100 && e.status <= 599 ? e.status : undefined;
  if (e.name === 'AbortError' || e.name === 'APIUserAbortError') { return new ProviderError('cancelled'); }
  if (e.name === 'APIConnectionTimeoutError' || e.name === 'TimeoutError') { return new ProviderError('timeout'); }
  if (status === 401 || e.code === 'invalid_api_key') { return new ProviderError('authentication', status); }
  if (status === 402) { return new ProviderError('credit', status); }
  if (status === 429) { return new ProviderError('rate-limit', status); }
  if (e.code === 'model_not_found' || e.code === 'model_not_available') { return new ProviderError('model', status); }
  if (status === 403) { return new ProviderError('permission', status); }
  if (e.name === 'APIConnectionError' || e.name === 'TypeError') { return new ProviderError('network', status); }
  return new ProviderError('unknown', status);
}
