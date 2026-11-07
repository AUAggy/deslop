/** Session-local ownership. No source or result is persisted. */
export type OperationState = 'preparing' | 'requesting' | 'reviewing' | 'recoverable' | 'applying' |
  'applied' | 'discarded' | 'cancelled';

export class RewriteOperation<T> {
  state: OperationState = 'preparing';
  readonly controller = new AbortController();
  snapshot?: Readonly<T>;
  result?: string;
  private revision = 0;
  private cleanup?: () => void;

  get token(): number { return this.revision; }

  get terminal(): boolean {
    return ['applied', 'discarded', 'cancelled'].includes(this.state);
  }

  capture(snapshot: T): void {
    this.snapshot = Object.freeze(snapshot);
  }

  /** Each asynchronous phase gets an ownership token; old callbacks cannot commit. */
  begin(state: 'preparing' | 'requesting' | 'reviewing' | 'recoverable' | 'applying'): number {
    if (this.terminal) { throw new Error('Operation already settled'); }
    this.state = state;
    return ++this.revision;
  }

  owns(token: number): boolean {
    return !this.terminal && !this.controller.signal.aborted && token === this.revision;
  }

  onCleanup(cleanup: () => void): void {
    this.cleanup?.();
    this.cleanup = cleanup;
  }

  finish(state: 'applied' | 'discarded' | 'cancelled'): void {
    if (this.terminal) { return; }
    this.state = state;
    ++this.revision;
    this.controller.abort();
    this.cleanup?.();
    this.cleanup = undefined;
    this.snapshot = undefined;
    this.result = undefined;
  }
}

export class OperationSlot<T> {
  active?: RewriteOperation<T>;

  acquire(): RewriteOperation<T> | undefined {
    if (this.active && !this.active.terminal) { return undefined; }
    return this.active = new RewriteOperation<T>();
  }

  owns(operation: RewriteOperation<T>): boolean {
    return this.active === operation && !operation.terminal;
  }

  dispose(): void {
    this.active?.finish('cancelled');
    this.active = undefined;
  }
}

export interface SourceSnapshot {
  readonly version: number;
  readonly text: string;
}

export function sourceIsFresh(
  snapshot: SourceSnapshot,
  source: { readonly isClosed: boolean; readonly version: number },
  selectedText: () => string
): boolean {
  return !source.isClosed && source.version === snapshot.version && selectedText() === snapshot.text;
}
