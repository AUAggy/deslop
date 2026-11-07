import { createHash, randomBytes } from 'crypto';
import { ProviderError } from './errors';

export const AUTH_LIFETIME_MS = 5 * 60 * 1000;
export interface CallbackUri { scheme: string; authority: string; path: string; query: string; fragment: string }
export interface ExchangeFields { code: string; code_verifier: string; code_challenge_method: 'S256' }
/** A session is deliberately bound to an unpredictable PATH, not undocumented state echo. */
export class PkceSession {
  private verifier: string | undefined = randomBytes(32).toString('base64url');
  readonly path = `/connect/openrouter/${randomBytes(32).toString('hex')}`;
  readonly challenge = createHash('sha256').update(this.verifier!).digest('base64url');
  private readonly expiresAt: number;
  constructor(readonly scheme: string, readonly authority: string, private readonly now = Date.now) {
    this.expiresAt = now() + AUTH_LIFETIME_MS;
  }
  cancel(): void { this.verifier = undefined; }
  consume(uri: CallbackUri): ExchangeFields {
    if (!this.verifier || this.now() >= this.expiresAt) { this.cancel(); throw new ProviderError('cancelled'); }
    if (uri.scheme !== this.scheme || uri.authority !== this.authority || uri.path !== this.path || uri.fragment || uri.query.length > 4096) {
      throw new ProviderError('malformed');
    }
    const params = new URLSearchParams(uri.query);
    const names = [...params.keys()];
    if (names.some(name => name !== 'code' && name !== 'error') || new Set(names).size !== names.length || names.length !== 1) {
      this.cancel(); throw new ProviderError('malformed');
    }
    if (params.has('error')) { this.cancel(); throw new ProviderError('cancelled'); }
    const code = params.get('code');
    if (!code || code.length > 2048 || !/^[\x21-\x7e]+$/.test(code)) { this.cancel(); throw new ProviderError('malformed'); }
    const verifier = this.verifier;
    this.cancel(); // Consume synchronously BEFORE starting any asynchronous exchange.
    return { code, code_verifier: verifier, code_challenge_method: 'S256' };
  }
  authorizationUrl(externalCallback: string): string {
    const url = new URL('https://openrouter.ai/auth');
    url.searchParams.set('callback_url', externalCallback);
    url.searchParams.set('code_challenge', this.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }
}
