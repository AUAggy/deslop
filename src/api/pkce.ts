import { createHash, randomBytes } from 'crypto';
import { ProviderError } from './errors';

export const AUTH_LIFETIME_MS = 5 * 60 * 1000;
/** Documented optional OpenRouter parameter (openrouter.ai/docs/oauth: prefills the created key's label). */
export const AUTH_KEY_LABEL = 'DeSlop';
export interface CallbackUri { scheme: string; authority: string; path: string; query: string; fragment: string }
export interface ExchangeFields { code: string; code_verifier: string; code_challenge_method: 'S256' }

// User-visible details are static text or name only a query-parameter NAME; they
// never contain code, verifier, query values, keys, or URLs.
const DENIED_DETAIL = 'authorisation denied or cancelled in the browser (callback carried an "error" parameter)';
const USED_DETAIL = 'connection already completed or cancelled; the callback cannot reuse it';
const EXPIRED_DETAIL = `connection window expired after ${AUTH_LIFETIME_MS / 60000} minutes without a valid callback`;
const malformedCallback = (reason: string) => new ProviderError('malformed', undefined, `malformed callback: ${reason}`);

type QueryOutcome = { ok: true; name: 'code' | 'error'; value: string } | { ok: false; reason: string };

/**
 * A session is bound to an unpredictable PATH (never an undocumented state echo)
 * and to the exact EXTERNAL callback — including its preset query, e.g. the
 * windowId parameter VS Code's asExternalUri appends — registered before the
 * browser flow starts. VS Code delivers inbound URIs without stripping that
 * preset query, so consume() must accept preset params plus the OAuth response.
 */
export class PkceSession {
  private verifier: string | undefined = randomBytes(32).toString('base64url');
  readonly path = `/connect/openrouter/${randomBytes(32).toString('hex')}`;
  readonly challenge = createHash('sha256').update(this.verifier!).digest('base64url');
  private readonly expiresAt: number;
  private expectedQuery: string | undefined;
  constructor(readonly scheme: string, readonly authority: string, private readonly now = Date.now) {
    this.expiresAt = now() + AUTH_LIFETIME_MS;
  }
  cancel(): void { this.verifier = undefined; }
  /** Bind the exact EXTERNAL callback (scheme/authority/path/query; never a fragment) handed to OpenRouter. Single-shot. */
  registerExternalCallback(external: CallbackUri): void {
    const presetNames = external.query.length <= 4096 ? [...new URLSearchParams(external.query).keys()] : [];
    if (this.expectedQuery !== undefined) { throw new ProviderError('malformed', undefined, 'a callback is already registered for this session'); }
    if (external.fragment) { throw new ProviderError('malformed', undefined, 'registered callback must not carry a fragment'); }
    if (external.scheme !== this.scheme || external.authority !== this.authority || external.path !== this.path) { throw new ProviderError('malformed', undefined, `registered callback does not target this session's path`); }
    if (external.query.length > 4096) { throw new ProviderError('malformed', undefined, 'registered callback query exceeds 4096 characters'); }
    const duplicate = presetNames.find((name, index) => presetNames.indexOf(name) !== index);
    if (duplicate !== undefined) { throw new ProviderError('malformed', undefined, `duplicate registered query parameter "${duplicate}"`); }
    const collision = presetNames.find(name => name === 'code' || name === 'error');
    if (collision !== undefined) { throw new ProviderError('malformed', undefined, `registered query parameter "${collision}" collides with the reserved OAuth response parameters "code" and "error"`); }
    this.expectedQuery = external.query;
  }
  consume(uri: CallbackUri): ExchangeFields {
    if (!this.verifier) {
      this.cancel();
      throw new ProviderError('cancelled', undefined, this.now() >= this.expiresAt ? EXPIRED_DETAIL : USED_DETAIL);
    }
    if (this.now() >= this.expiresAt) { this.cancel(); throw new ProviderError('cancelled', undefined, EXPIRED_DETAIL); }
    // Hostile or unrelated callback: reject WITHOUT disarming the session so the genuine callback can still land.
    if (uri.scheme !== this.scheme || uri.authority !== this.authority || uri.path !== this.path) {
      throw malformedCallback(`callback does not target this session's registered path`);
    }
    if (uri.fragment) { throw malformedCallback('callback URI must not carry a fragment'); }
    if (uri.query.length > 4096) { throw malformedCallback('callback URI query exceeds 4096 characters'); }
    const outcome = this.matchCallbackQuery(uri.query);
    if (!outcome.ok) { this.cancel(); throw malformedCallback(outcome.reason); }
    if (outcome.name === 'error') { this.cancel(); throw new ProviderError('cancelled', undefined, DENIED_DETAIL); }
    const code = outcome.value;
    if (!code || code.length > 2048 || !/^[\x21-\x7e]+$/.test(code)) {
      this.cancel(); throw malformedCallback('"code" query parameter is empty, overlong, or not printable ASCII');
    }
    const verifier = this.verifier;
    this.cancel(); // Consume synchronously BEFORE starting any asynchronous exchange.
    return { code, code_verifier: verifier, code_challenge_method: 'S256' };
  }
  /**
   * The inbound query must be exactly the registered preset params (same names AND values)
   * plus exactly one of code/error; duplicates and unknown params reject with a reason that
   * names the offending parameter (never its value). OpenRouter appends the code to the
   * callback, and with a preset query present its naive join can produce a second `?`
   * (preset?code=…). Canonicalise ONLY on an exact registered-prefix match with a clean
   * remainder, then revalidate strictly.
   */
  private matchCallbackQuery(raw: string): QueryOutcome {
    const expected = this.expectedQuery ?? '';
    let query = raw;
    if (expected && query !== expected && query.startsWith(`${expected}?`)) {
      const rest = raw.slice(expected.length + 1);
      if (!rest.includes('?')) { query = `${expected}&${rest}`; } // A second embedded ? is not a naive join: leave it unparsed so strict validation rejects.
    }
    const params = new URLSearchParams(query);
    const names = [...params.keys()];
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate !== undefined) { return { ok: false, reason: `duplicate query parameter "${duplicate}"` }; }
    const presets = expected ? [...new URLSearchParams(expected)] : [];
    const presetNames = new Set(presets.map(([name]) => name));
    for (const [name, value] of presets) {
      if (!params.has(name)) { return { ok: false, reason: `missing registered query parameter "${name}"` }; }
      if (params.get(name) !== value) { return { ok: false, reason: `query parameter "${name}" does not match the registered callback value` }; }
    }
    const extras = names.filter(name => !presetNames.has(name));
    if (extras.length === 2 && extras.every(name => name === 'code' || name === 'error')) {
      return { ok: false, reason: 'both "code" and "error" query parameters present' };
    }
    if (extras.length === 1 && (extras[0] === 'code' || extras[0] === 'error')) {
      return { ok: true, name: extras[0] as 'code' | 'error', value: params.get(extras[0])! };
    }
    const offender = extras.find(name => name !== 'code' && name !== 'error');
    return {
      ok: false,
      reason: offender === undefined
        ? 'no "code" or "error" query parameter present'
        : `unexpected query parameter "${offender}" (registered preset parameters plus exactly one of "code" or "error" are allowed)`,
    };
  }
  authorizationUrl(externalCallback: string): string {
    const url = new URL('https://openrouter.ai/auth');
    url.searchParams.set('callback_url', externalCallback);
    url.searchParams.set('code_challenge', this.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('key_label', AUTH_KEY_LABEL);
    return url.toString();
  }
}
