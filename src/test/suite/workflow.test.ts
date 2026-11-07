import * as assert from 'assert';
import { OperationSlot, sourceIsFresh } from '../../commands/operation';

suite('Rewrite operation ownership', () => {
  test('acquires before asynchronous setup and blocks repeated invocations', () => {
    const slot = new OperationSlot<{ text: string }>();
    const operation = slot.acquire()!;
    operation.capture({ text: 'original' });
    assert.strictEqual(slot.acquire(), undefined);
    assert.ok(Object.isFrozen(operation.snapshot));
    operation.finish('discarded');
    assert.ok(slot.acquire());
  });

  test('late results cannot own a cancelled or superseded phase', () => {
    const slot = new OperationSlot<unknown>();
    const op = slot.acquire()!;
    const setup = op.begin('preparing');
    const request = op.begin('requesting');
    assert.ok(!op.owns(setup));
    assert.ok(op.owns(request));
    op.finish('cancelled');
    assert.ok(op.controller.signal.aborted);
    assert.ok(!op.owns(request));
    assert.ok(!slot.owns(op));
  });

  test('retry retains captured source and choices without recursive acquisition', () => {
    const slot = new OperationSlot<{ text: string; model: string }>();
    const op = slot.acquire()!;
    op.capture({ text: 'original', model: 'captured-model' });
    const snapshot = op.snapshot;
    op.begin('requesting');
    op.begin('recoverable');
    op.begin('requesting');
    assert.strictEqual(op.snapshot, snapshot);
    assert.strictEqual(slot.acquire(), undefined);
  });

  test('recovery preserves completed result and cleans up exactly once', () => {
    const slot = new OperationSlot<unknown>();
    const op = slot.acquire()!;
    let cleanups = 0;
    op.onCleanup(() => cleanups++);
    op.result = 'completed';
    op.begin('recoverable');
    assert.strictEqual(op.result, 'completed');
    op.finish('discarded');
    op.finish('applied');
    assert.strictEqual(op.state, 'discarded');
    assert.strictEqual(cleanups, 1);
  });

  test('extension disposal aborts requests and settles resources', () => {
    const slot = new OperationSlot<unknown>();
    const op = slot.acquire()!;
    slot.dispose();
    assert.strictEqual(op.state, 'cancelled');
    assert.ok(op.controller.signal.aborted);
  });

  test('freshness rejects changed and closed source, even matching text', () => {
    const snapshot = { version: 2, text: 'original' };
    assert.ok(sourceIsFresh(snapshot, { version: 2, isClosed: false }, () => 'original'));
    assert.ok(!sourceIsFresh(snapshot, { version: 3, isClosed: false }, () => 'original'));
    assert.ok(!sourceIsFresh(snapshot, { version: 2, isClosed: true }, () => 'original'));
    assert.ok(!sourceIsFresh(snapshot, { version: 2, isClosed: false }, () => 'changed'));
  });
});
