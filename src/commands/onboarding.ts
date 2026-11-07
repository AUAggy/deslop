import * as vscode from 'vscode';
import { getApiKey, setApiKey, deleteApiKey, beginCredentialIntent, credentialGeneration } from '../storage/secrets';
import { activeProvider, captureRequestOptions, verifyAuthentication, testModelReadiness, type Provider } from '../api/providers';
import { classifyProviderError } from '../api/errors';
import { connectOpenRouter, registerConnectionHandlers as registerAuthHandlers } from './connectionAuth';
import { replaceCredential } from '../storage/credentialReplacement';
export function registerConnectionHandlers(context: vscode.ExtensionContext): vscode.Disposable {
  const auth = registerAuthHandlers(context);
  const changes = context.secrets.onDidChange?.(() => { connectionEpoch++; lastTests.clear(); });
  const settings = vscode.workspace.onDidChangeConfiguration?.(event => {
    if (event.affectsConfiguration('deslop.model') || event.affectsConfiguration('deslop.provider')) { connectionEpoch++; lastTests.clear(); }
  });
  return new vscode.Disposable(() => { auth.dispose(); changes?.dispose(); settings?.dispose(); lastTests.clear(); });
}

const PROVIDER_INFO = {
  openrouter: { name: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', placeholder: 'sk-or-...' },
  venice: { name: 'Venice', keyUrl: 'https://venice.ai/settings/api', placeholder: 'venice-...' },
} as const;
const lastTests = new Map<Provider, { generation: number; model?: string; label: string }>(); // Session-only, no credentials.
let connectionEpoch = 0;

async function setupPrompt<T>(signal: AbortSignal | undefined, run: (token?: vscode.CancellationToken) => Thenable<T>): Promise<T | undefined> {
  if (signal?.aborted) { return undefined; }
  if (!signal) { return run(); }
  const source = new vscode.CancellationTokenSource();
  let stop!: () => void;
  const stopped = new Promise<undefined>(resolve => { stop = () => { source.cancel(); resolve(undefined); }; });
  signal.addEventListener('abort', stop, { once: true });
  try { return await Promise.race([Promise.resolve(run(source.token)), stopped]); }
  finally { signal.removeEventListener('abort', stop); source.dispose(); }
}

async function openAccount(provider: Provider): Promise<boolean> {
  try { return await vscode.env.openExternal(vscode.Uri.parse(PROVIDER_INFO[provider].keyUrl)); }
  catch { return false; }
}

/** Caller retains the source snapshot; this function never restarts the rewrite command. */
export async function ensureApiKey(secrets: vscode.SecretStorage, provider: Provider = activeProvider(), signal?: AbortSignal): Promise<string | undefined> {
  if (signal?.aborted) { return undefined; }
  const existing = await setupPrompt(signal, () => getApiKey(secrets, provider));
  if (signal?.aborted) { return undefined; }
  if (existing) { return existing; }
  const info = PROVIDER_INFO[provider];
  const action = await setupPrompt(signal, () => vscode.window.showInformationMessage(`DeSlop needs a ${info.name} connection. Your pending selection stays in memory during setup.`, ...(provider === 'openrouter' ? ['Connect OpenRouter'] : []), 'Enter Key', 'Get Key'));
  if (signal?.aborted) { return undefined; }
  if (action === 'Connect OpenRouter') {
    const key = await connectOpenRouter(signal);
    if (key) { lastTests.delete(provider); return key; }
    if (signal?.aborted) { return undefined; }
    const fallback = await setupPrompt(signal, () => vscode.window.showInformationMessage('Browser connection was not completed. Enter a key instead, or restart setup later. An expired, reloaded, or wrong-window callback cannot resume this session.', 'Enter Key'));
    if (fallback !== 'Enter Key') { return undefined; }
  } else if (action === 'Get Key') {
    const opened = await setupPrompt(signal, () => openAccount(provider));
    if (signal?.aborted) { return undefined; }
    const next = await setupPrompt(signal, () => vscode.window.showInformationMessage(opened ? `Create a key in your ${info.name} account, then continue here.` : `Could not open the browser. Visit ${info.keyUrl} manually, then continue here.`, 'Enter Key'));
    if (next !== 'Enter Key') { return undefined; }
  } else if (action !== 'Enter Key') { return undefined; }
  return promptAndSaveKey(secrets, provider, signal);
}

export async function promptAndSaveKey(secrets: vscode.SecretStorage, provider: Provider = activeProvider(), signal?: AbortSignal): Promise<string | undefined> {
  const info = PROVIDER_INFO[provider];
  while (!signal?.aborted) {
    const raw = await setupPrompt(signal, token => vscode.window.showInputBox({ prompt: `Paste your ${info.name} API key. The current key stays until verification and saving succeed.`, password: true, ignoreFocusOut: true, placeHolder: info.placeholder }, token));
    if (!raw || signal?.aborted) { return undefined; }
    const key = raw.trim();
    if (key.length > 4096 || !/^[\x21-\x7e]+$/.test(key)) {
      void vscode.window.showErrorMessage('The key format is not supported. No credential was changed.');
      return undefined;
    }
    const intent = beginCredentialIntent(secrets, provider);
    let verificationError: unknown;
    const result = await replaceCredential(key, provider, {
      cancelled: () => !!signal?.aborted || !intent.current(),
      verify: async (candidate, captured) => {
        try { await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Checking ${info.name} authentication (no completion request)`, cancellable: false }, () => verifyAuthentication(candidate, captured, signal)); }
        catch (error) { verificationError = error; throw error; }
      },
      save: (candidate, captured) => setApiKey(secrets, candidate, captured, intent, () => !!signal?.aborted),
    });
    if (result === 'cancelled') { return undefined; }
    if (result === 'verification-failed') {
      const retry = await vscode.window.showErrorMessage(`${info.name}: ${classifyProviderError(verificationError).message} The stored key was not changed.`, 'Try Again', 'Open Provider Account');
      if (retry === 'Open Provider Account') { await openAccount(provider); }
      if (retry !== 'Try Again') { return undefined; }
      continue;
    }
    if (result === 'storage-uncertain') {
      lastTests.delete(provider);
      void vscode.window.showErrorMessage(`${info.name} credential saving failed. Storage state is uncertain; check Manage Connection and test before retrying. No deliberate deletion was performed.`);
      return undefined;
    }
    lastTests.delete(provider);
    void vscode.window.showInformationMessage(`${info.name} key saved; authentication checked. Model access and credit readiness have not been tested.`);
    return key;
  }
  return undefined;
}

/** Legacy reset now means non-destructive replacement. */
export async function resetApiKey(secrets: vscode.SecretStorage, provider: Provider = activeProvider()): Promise<void> {
  await promptAndSaveKey(secrets, provider);
}
export async function disconnectProvider(secrets: vscode.SecretStorage, provider: Provider = activeProvider()): Promise<void> {
  const name = PROVIDER_INFO[provider].name;
  const confirm = await vscode.window.showWarningMessage(`Disconnect ${name}? Only its locally stored key will be removed. This does not revoke the key at the provider.`, { modal: true }, 'Disconnect');
  if (confirm !== 'Disconnect') { return; }
  lastTests.delete(provider);
  try {
    if (await deleteApiKey(secrets, provider)) { void vscode.window.showInformationMessage(`${name} disconnected locally.`); }
    else { void vscode.window.showInformationMessage(`${name} connection changed again; check Manage Connection for its current state.`); }
  }
  catch { void vscode.window.showErrorMessage(`${name} disconnect failed. Check the stored connection before retrying.`); }
}
export async function manageConnection(secrets: vscode.SecretStorage, provider?: Provider): Promise<void> {
  if (!provider) {
    const selected = await vscode.window.showQuickPick([{ label: 'OpenRouter', provider: 'openrouter' as const }, { label: 'Venice', provider: 'venice' as const }], { title: `Manage Connection (rewrite provider: ${PROVIDER_INFO[activeProvider()].name})` });
    if (!selected) { return; }
    provider = selected.provider;
  }
  const captured = provider;
  const name = PROVIDER_INFO[captured].name;
  const generation = credentialGeneration(secrets, captured);
  const epoch = connectionEpoch;
  const current = () => credentialGeneration(secrets, captured) === generation && connectionEpoch === epoch;
  const key = await getApiKey(secrets, captured);
  if (!current()) { return; }
  const request = captureRequestOptions(captured);
  const last = lastTests.get(captured);
  const status = last?.generation === generation && (!last.model || last.model === request.model) ? last.label : 'not tested for this credential/model';
  const items = [...(captured === 'openrouter' ? ['Connect OpenRouter'] : []), key ? 'Replace Key' : 'Enter Key', 'Test Authentication', 'Test Model Readiness (may incur charges)', 'Open Provider Account', ...(key ? ['Disconnect'] : [])];
  const action = await vscode.window.showQuickPick(items, { title: `${name}: ${key ? 'key stored' : 'no key'}; ${status}` });
  if (action === 'Enter Key' || action === 'Replace Key') { await promptAndSaveKey(secrets, captured); }
  else if (action === 'Connect OpenRouter') {
    if (await connectOpenRouter()) { lastTests.delete(captured); }
    else if (await vscode.window.showInformationMessage('Browser connection did not complete. Enter a key instead, or reopen Manage Connection to restart.', 'Enter Key') === 'Enter Key') {
      await promptAndSaveKey(secrets, captured);
    }
  }
  else if (action === 'Disconnect') { await disconnectProvider(secrets, captured); }
  else if (action === 'Open Provider Account') { if (!await openAccount(captured)) { void vscode.window.showErrorMessage(`Could not open ${PROVIDER_INFO[captured].keyUrl}.`); } }
  else if (action?.startsWith('Test')) {
    if (!key) { void vscode.window.showInformationMessage('Connect or enter a key first.'); return; }
    const options = request;
    const modelTest = action.startsWith('Test Model');
    if (modelTest && await vscode.window.showWarningMessage(`Send a small completion to ${name}, model ${options.model}? This may incur provider usage charges. Authentication alone does not require a completion.`, { modal: true }, 'Run Test') !== 'Run Test') { return; }
    if (!current()) { return; }
    try {
      if (modelTest) { await testModelReadiness(key, options); }
      else { await verifyAuthentication(key, captured); }
      if (!current()) { return; }
      const status = modelTest ? `model ${options.model} responded at ${new Date().toISOString()} (not a guarantee of future availability)` : `authentication checked at ${new Date().toISOString()}; model readiness untested`;
      lastTests.set(captured, { generation, model: modelTest ? options.model : undefined, label: status });
      void vscode.window.showInformationMessage(`${name}: ${status}.`);
    } catch (error) {
      if (!current()) { return; }
      lastTests.set(captured, { generation, model: modelTest ? options.model : undefined, label: modelTest ? `last test of ${options.model} failed` : 'last authentication test failed' });
      const safe = classifyProviderError(error);
      const action = await vscode.window.showErrorMessage(`${name}: ${safe.message}`, ...safe.actions.filter(action => action !== 'Retry'));
      if (action === 'Replace Key') { await promptAndSaveKey(secrets, captured); }
      else if (action === 'Open Provider Account') { await openAccount(captured); }
      else if (action === 'Change Model') {
        // Changing settings never silently sends a completion or revises a pending operation.
        await vscode.commands.executeCommand('workbench.action.openSettings', 'deslop.model');
      }
    }
  }
}
