import * as vscode from 'vscode';
import OpenAI from 'openai';
import { AUTH_LIFETIME_MS, PkceSession } from '../api/pkce';
import { classifyProviderError, ProviderError } from '../api/errors';
import { verifyAuthentication } from '../api/providers';
import { setApiKey } from '../storage/secrets';

interface Pending {
  session: PkceSession;
  abort: AbortController;
  exchanging?: boolean;
  settle: (key: string | undefined) => void;
}
let extensionId: string | undefined;
let pending: Pending | undefined;
let connecting = false;

export function registerConnectionHandlers(context: vscode.ExtensionContext): vscode.Disposable {
  extensionId = context.extension.id;
  const handler = vscode.window.registerUriHandler({ handleUri: async uri => {
    const attempt = pending;
    if (!attempt) { return; }
    // Unrelated/unsolicited callbacks cannot interrupt an active session.
    if (uri.scheme !== attempt.session.scheme || uri.authority !== attempt.session.authority || uri.path !== attempt.session.path) { return; }
    try {
      if (attempt.exchanging) { return; }
      const fields = attempt.session.consume(uri);
      attempt.exchanging = true;
      const client = new OpenAI({ apiKey: 'unused', baseURL: 'https://openrouter.ai/api/v1', maxRetries: 0 });
      const result = await client.post<{ key?: unknown }>('/auth/keys', {
        body: fields, headers: { Authorization: null }, timeout: 15000, signal: attempt.abort.signal,
      });
      if (!result || typeof result.key !== 'string' || result.key.length > 4096 || !/^[\x21-\x7e]+$/.test(result.key)) { throw new ProviderError('malformed'); }
      await verifyAuthentication(result.key, 'openrouter', attempt.abort.signal);
      if (pending !== attempt || attempt.abort.signal.aborted) { return; }
      // No asynchronous UI boundary between ownership check and SecretStorage submission.
      await setApiKey(context.secrets, result.key, 'openrouter');
      if (pending === attempt) {
        void vscode.window.showInformationMessage('OpenRouter key saved; authentication checked. Model access and available credit have not been tested.');
        attempt.settle(result.key);
      }
    } catch (error) {
      if (pending === attempt) {
        void vscode.window.showErrorMessage(`OpenRouter authorisation did not complete. ${classifyProviderError(error).message} Use Enter Key or start a new connection. If saving failed, check the stored connection before retrying.`);
        attempt.settle(undefined);
      }
    }
  } });
  return new vscode.Disposable(() => {
    pending?.settle(undefined);
    extensionId = undefined;
    handler.dispose();
  });
}

export async function connectOpenRouter(signal?: AbortSignal): Promise<string | undefined> {
  const authority = extensionId;
  if (!authority || signal?.aborted || connecting) { return undefined; }
  connecting = true; // Claim synchronously, including the consent dialog.
  try {
  const consent = await vscode.window.showInformationMessage('Connect your OpenRouter account in the browser. You need an account and credits; OpenRouter bills your requests. No DeSlop backend is involved.', { modal: true }, 'Continue');
  if (consent !== 'Continue' || signal?.aborted || extensionId !== authority) { return undefined; }
  return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Waiting for OpenRouter. Cancel to use manual key entry.', cancellable: true }, async (_progress, token) => {
    const session = new PkceSession(vscode.env.uriScheme, authority);
    const abort = new AbortController();
    let resolve!: (key: string | undefined) => void;
    const result = new Promise<string | undefined>(r => { resolve = r; });
    const attempt: Pending = { session, abort, settle: key => {
      if (pending !== attempt) { return; }
      pending = undefined;
      session.cancel(); abort.abort(); resolve(key);
    } };
    pending = attempt;
    const timer = setTimeout(() => attempt.settle(undefined), AUTH_LIFETIME_MS);
    const cancellation = token.onCancellationRequested(() => attempt.settle(undefined));
    const cancel = () => attempt.settle(undefined);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const callback = vscode.Uri.from({ scheme: session.scheme, authority: session.authority, path: session.path });
      const external = await vscode.env.asExternalUri(callback);
      if (pending !== attempt || signal?.aborted || token.isCancellationRequested) { attempt.settle(undefined); return undefined; }
      const opened = await vscode.env.openExternal(vscode.Uri.parse(session.authorizationUrl(external.toString())));
      if (!opened) { attempt.settle(undefined); }
      return await result;
    } catch {
      attempt.settle(undefined);
      return undefined;
    } finally {
      clearTimeout(timer); cancellation.dispose(); signal?.removeEventListener('abort', cancel);
    }
  });
  } finally { connecting = false; }
}
