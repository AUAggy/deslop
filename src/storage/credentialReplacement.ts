import type { Provider } from '../api/providers';

export type ReplacementResult = 'saved' | 'cancelled' | 'verification-failed' | 'storage-uncertain';
/** Testable transaction boundary. Never delete first, roll back blindly, or retarget provider. */
export async function replaceCredential(
  candidate: string | undefined,
  provider: Provider,
  dependencies: {
    verify: (key: string, provider: Provider) => Promise<void>;
    save: (key: string, provider: Provider) => Promise<void>;
    cancelled: () => boolean;
  }
): Promise<ReplacementResult> {
  if (!candidate || dependencies.cancelled()) { return 'cancelled'; }
  try { await dependencies.verify(candidate, provider); }
  catch { return dependencies.cancelled() ? 'cancelled' : 'verification-failed'; }
  if (dependencies.cancelled()) { return 'cancelled'; }
  // Once submitted, SecretStorage.store cannot be aborted or reliably rolled back.
  try { await dependencies.save(candidate, provider); }
  catch { return 'storage-uncertain'; }
  return 'saved';
}
