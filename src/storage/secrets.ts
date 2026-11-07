import * as vscode from 'vscode';
import { activeProvider, type Provider } from '../api/providers';

const KEYS = { openrouter: 'deslop.openrouterApiKey', venice: 'deslop.veniceApiKey' } as const;
interface Writer { generation: number; tail: Promise<void> }
// Ordering is extension-host-local. SecretStorage offers no cross-window CAS;
// external changes invalidate UI test status through its public change event.
const writers = new WeakMap<vscode.SecretStorage, Map<Provider, Writer>>();
function writer(secrets: vscode.SecretStorage, provider: Provider): Writer {
  let providers = writers.get(secrets);
  if (!providers) { providers = new Map(); writers.set(secrets, providers); }
  let state = providers.get(provider);
  if (!state) { state = { generation: 0, tail: Promise.resolve() }; providers.set(provider, state); }
  return state;
}

export interface CredentialIntent {
  readonly provider: Provider;
  readonly current: () => boolean;
  /** Keep a submitted, non-abortable write in the queue even if its caller cancels. */
  readonly commit: (mutation: () => PromiseLike<void>, cancelled?: () => boolean) => Promise<boolean>;
}

export function credentialGeneration(secrets: vscode.SecretStorage, provider: Provider): number {
  return writer(secrets, provider).generation;
}

/** Claim at explicit candidate/authorisation consent, or confirmed disconnect. */
export function beginCredentialIntent(secrets: vscode.SecretStorage, provider: Provider): CredentialIntent {
  const state = writer(secrets, provider);
  const generation = ++state.generation;
  const current = () => state.generation === generation;
  return { provider, current, commit(mutation, cancelled = () => false) {
    const committed = state.tail.then(async () => {
      if (!current() || cancelled()) { return false; }
      await mutation();
      return current() && !cancelled();
    });
    state.tail = committed.then(() => undefined, () => undefined);
    return committed;
  } };
}

export async function getApiKey(secrets: vscode.SecretStorage, provider: Provider = activeProvider()): Promise<string | undefined> {
  const state = writer(secrets, provider);
  await state.tail;
  return secrets.get(KEYS[provider]);
}

export async function setApiKey(
  secrets: vscode.SecretStorage, key: string, provider: Provider = activeProvider(),
  intent: CredentialIntent = beginCredentialIntent(secrets, provider), cancelled?: () => boolean
): Promise<boolean> {
  if (intent.provider !== provider) { return false; }
  return intent.commit(() => secrets.store(KEYS[provider], key), cancelled);
}

export async function deleteApiKey(secrets: vscode.SecretStorage, provider: Provider = activeProvider()): Promise<boolean> {
  const intent = beginCredentialIntent(secrets, provider);
  return intent.commit(() => secrets.delete(KEYS[provider]));
}
