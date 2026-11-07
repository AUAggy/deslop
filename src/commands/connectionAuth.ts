import * as vscode from 'vscode';
import OpenAI from 'openai';
import { AUTH_LIFETIME_MS, PkceSession } from '../api/pkce';
import { ProviderError } from '../api/errors';
import { OPENROUTER_AUTH_NEXT_STEP, OPENROUTER_TIMEOUT_MESSAGE, openRouterAuthFailureMessage, type AuthPhase } from '../api/authMessages';
import { verifyAuthentication } from '../api/providers';
import { setApiKey, beginCredentialIntent, type CredentialIntent } from '../storage/secrets';

interface Pending {
  session: PkceSession;
  abort: AbortController;
  intent: CredentialIntent;
  phase: AuthPhase;
  exchanging?: boolean;
  settle: (key: string | undefined) => void;
}
let extensionId: string | undefined;
let secretStorage: vscode.SecretStorage | undefined;
let pending: Pending | undefined;
let connecting = false;
let cancelConsent: (() => void) | undefined;

export function registerConnectionHandlers(context: vscode.ExtensionContext): vscode.Disposable {
  extensionId = context.extension.id;
  secretStorage = context.secrets;
  const handler = vscode.window.registerUriHandler({ handleUri: async uri => {
    const attempt = pending;
    if (!attempt) { return; }
    // Unrelated/unsolicited callbacks cannot interrupt an active session.
    if (uri.scheme !== attempt.session.scheme || uri.authority !== attempt.session.authority || uri.path !== attempt.session.path) { return; }
    try {
      if (attempt.exchanging) { return; }
      if (!attempt.intent.current()) { attempt.settle(undefined); return; }
      const fields = attempt.session.consume(uri);
      attempt.exchanging = true;
      attempt.phase = 'exchange';
      const client = new OpenAI({ apiKey: 'unused', baseURL: 'https://openrouter.ai/api/v1', maxRetries: 0, logLevel: 'off' });
      const result = await client.post<{ key?: unknown }>('/auth/keys', {
        body: fields, headers: { Authorization: null }, timeout: 15000, signal: attempt.abort.signal,
      });
      if (!result || typeof result.key !== 'string' || result.key.length > 4096 || !/^[\x21-\x7e]+$/.test(result.key)) { throw new ProviderError('malformed'); }
      attempt.phase = 'verify';
      await verifyAuthentication(result.key, 'openrouter', attempt.abort.signal);
      if (pending !== attempt || attempt.abort.signal.aborted) { return; }
      attempt.phase = 'save';
      const saved = await setApiKey(context.secrets, result.key, 'openrouter', attempt.intent, () => attempt.abort.signal.aborted);
      if (!saved) { attempt.settle(undefined); return; }
      if (pending === attempt) {
        void vscode.window.showInformationMessage('OpenRouter key saved; authentication checked. Model access and available credit have not been tested.');
        attempt.settle(result.key);
      }
    } catch (error) {
      if (pending === attempt) {
        void vscode.window.showErrorMessage(`OpenRouter authorisation did not complete. ${openRouterAuthFailureMessage(attempt.phase, error)} ${OPENROUTER_AUTH_NEXT_STEP}`);
        attempt.settle(undefined);
      }
    }
  } });
  return new vscode.Disposable(() => {
    pending?.settle(undefined);
    cancelConsent?.();
    extensionId = undefined;
    secretStorage = undefined;
    handler.dispose();
  });
}

export async function connectOpenRouter(signal?: AbortSignal): Promise<string | undefined> {
  const authority = extensionId;
  const secrets = secretStorage;
  if (!authority || !secrets || signal?.aborted || connecting) { return undefined; }
  connecting = true; // Claim synchronously, including the consent dialog.
  let stopConsent!: () => void;
  const stopped = new Promise<undefined>(resolve => { stopConsent = () => resolve(undefined); });
  cancelConsent = stopConsent;
  signal?.addEventListener('abort', stopConsent, { once: true });
  try {
  const consent = await Promise.race([
    vscode.window.showInformationMessage('Connect your OpenRouter account in the browser. You need an account and credits; OpenRouter bills your requests. No DeSlop backend is involved.', { modal: true }, 'Continue'),
    stopped,
  ]);
  if (consent !== 'Continue' || signal?.aborted || extensionId !== authority) { return undefined; }
  return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Waiting for OpenRouter. Cancel to use manual key entry.', cancellable: true }, async (_progress, token) => {
    // A deferred progress task can start after cancellation or handler disposal.
    // Check ownership before constructing or routing anything, then again after
    // the abort/cancel listeners are installed to close the pre-listener gap.
    const live = () => extensionId === authority && secretStorage === secrets;
    const terminal = () => !!signal?.aborted || token.isCancellationRequested || !live();
    if (terminal()) { return undefined; }
    const session = new PkceSession(vscode.env.uriScheme, authority);
    const abort = new AbortController();
    let resolve!: (key: string | undefined) => void;
    const result = new Promise<string | undefined>(r => { resolve = r; });
    const intent = beginCredentialIntent(secrets, 'openrouter');
    const attempt: Pending = { session, abort, intent, phase: 'callback', settle: key => {
      if (pending !== attempt) { return; }
      pending = undefined;
      session.cancel(); abort.abort(); resolve(key);
    } };
    pending = attempt;
    const timer = setTimeout(() => {
      if (pending === attempt) { void vscode.window.showWarningMessage(OPENROUTER_TIMEOUT_MESSAGE); }
      attempt.settle(undefined);
    }, AUTH_LIFETIME_MS);
    const cancellation = token.onCancellationRequested(() => attempt.settle(undefined));
    const cancel = () => attempt.settle(undefined);
    signal?.addEventListener('abort', cancel, { once: true });
    if (terminal()) { attempt.settle(undefined); return await result; }
    try {
      const callback = vscode.Uri.from({ scheme: session.scheme, authority: session.authority, path: session.path });
      const routed = await Promise.race([
        vscode.env.asExternalUri(callback).then(external => ({ external })),
        result.then(() => undefined),
      ]);
      if (!routed) { return await result; }
      if (terminal() || pending !== attempt || !intent.current()) { attempt.settle(undefined); return undefined; }
      // Bind the exact EXTERNAL callback (including the preset query asExternalUri added)
      // before the browser opens; consume() validates inbound callbacks against it.
      session.registerExternalCallback(routed.external);
      const opened = await Promise.race([
        vscode.env.openExternal(vscode.Uri.parse(session.authorizationUrl(routed.external.toString()))),
        result.then(() => undefined),
      ]);
      if (!opened) { attempt.settle(undefined); }
      return await result;
    } catch {
      attempt.settle(undefined);
      return undefined;
    } finally {
      clearTimeout(timer); cancellation.dispose(); signal?.removeEventListener('abort', cancel);
    }
  });
  } finally {
    signal?.removeEventListener('abort', stopConsent);
    if (cancelConsent === stopConsent) { cancelConsent = undefined; }
    connecting = false;
  }
}
