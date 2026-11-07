import { AUTH_LIFETIME_MS } from './pkce';
import { classifyProviderError } from './errors';

export type AuthPhase = 'callback' | 'exchange' | 'verify' | 'save';

const PHASE_LABELS: Record<Exclude<AuthPhase, 'callback'>, string> = {
  exchange: 'key exchange failed',
  verify: 'authentication check failed',
  save: 'credential saving failed',
};

/**
 * Exact user-visible failure reason for an OpenRouter connection attempt.
 * Static, non-sensitive text only: parameter NAMES, categories, and HTTP status
 * codes — never code, verifier, query values, keys, or URLs. Callback-phase
 * errors already carry their precise detail verbatim; other phases get the
 * phase label plus the safe category message and status.
 */
export function openRouterAuthFailureMessage(phase: AuthPhase, error: unknown): string {
  const safe = classifyProviderError(error);
  if (phase === 'callback') { return safe.message; }
  const status = typeof safe.status === 'number' ? ` (HTTP ${safe.status})` : '';
  return `${PHASE_LABELS[phase]}${status}: ${safe.message}`;
}

export const OPENROUTER_AUTH_NEXT_STEP = 'Use Enter Key for manual setup, or start a new connection. If saving failed, check the stored connection before retrying.';
export const OPENROUTER_TIMEOUT_MESSAGE = `OpenRouter connection window timed out after ${AUTH_LIFETIME_MS / 60000} minutes with no valid callback. A declined browser or editor permission prompt prevents completion. ${OPENROUTER_AUTH_NEXT_STEP}`;
