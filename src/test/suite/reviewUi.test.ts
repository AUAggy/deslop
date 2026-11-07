import * as assert from 'assert';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import * as vm from 'vm';
import type * as Review from '../../ui/diff';

// Load compiled production modules against a deliberately small public-API fake.
// These are deterministic lifecycle checks, NOT native editor compatibility evidence.
class Emitter<T = unknown> {
  private listeners = new Set<(event: T) => void>();
  event = (listener: (event: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(event: T): void { for (const listener of [...this.listeners]) { listener(event); } }
  dispose(): void { this.listeners.clear(); }
}
class Uri {
  constructor(private readonly value: string) {}
  static parse(value: string): Uri { return new Uri(value); }
  toString(): string { return this.value; }
}
class TabDiff {
  constructor(readonly original: Uri, readonly modified: Uri) {}
}

function harness() {
  const commands = new Map<string, (...args: any[]) => any>();
  const providers = new Map<string, any>();
  const contexts = new Map<string, unknown>();
  const changedTabs = new Emitter<any>();
  const changedGroups = new Emitter<any>();
  const changedEditor = new Emitter<any>();
  const subscriptions: { dispose(): void }[] = [];
  const group: { tabs: any[]; activeTab?: any } = { tabs: [] };
  const warnings: string[] = [];
  const output: { lines: string[]; shown: number } = { lines: [], shown: 0 };
  const pickers: any[] = [];
  let clipboard = '';
  let failOpen = false;
  let diffCalls = 0;
  let delayed = false;
  const models = new Map<string, string>();
  const api = {
    Uri, TabInputTextDiff: TabDiff, EventEmitter: Emitter,
    StatusBarAlignment: { Left: 1 }, ThemeIcon: class { constructor(readonly id: string) {} },
    commands: {
      registerCommand(id: string, callback: (...args: any[]) => any) {
        assert.ok(!commands.has(id), `duplicate registration ${id}`);
        commands.set(id, callback);
        return { dispose: () => commands.delete(id) };
      },
      async executeCommand(id: string, ...args: any[]) {
        if (id === 'setContext') { contexts.set(args[0], args[1]); return; }
        if (id === 'vscode.diff') {
          diffCalls++;
          if (failOpen) { throw new Error('mock editor failure'); }
          for (const uri of [args[0], args[1]]) {
            if (!models.has(uri.toString())) { models.set(uri.toString(), providers.get('deslop-review').provideTextDocumentContent(uri)); }
          }
          const existing = group.tabs.find(tab => tab.input.original.toString() === args[0].toString() && tab.input.modified.toString() === args[1].toString());
          const tab = existing ?? { input: new TabDiff(args[0], args[1]), label: args[2] };
          if (!existing) { group.tabs.push(tab); }
          group.activeTab = tab;
          changedTabs.fire({ closed: [], opened: existing ? [] : [tab], changed: [] });
          return;
        }
        return commands.get(id)?.(...args);
      },
    },
    workspace: {
      get textDocuments() { return [...models.keys()].map(uri => ({ uri: Uri.parse(uri), getText: () => models.get(uri)! })); },
      onDidChangeTextDocument: new Emitter<any>().event,
      registerTextDocumentContentProvider(scheme: string, provider: unknown) {
        providers.set(scheme, provider);
        (provider as any).onDidChange((uri: Uri) => {
          if (!delayed && models.has(uri.toString())) { models.set(uri.toString(), (provider as any).provideTextDocumentContent(uri)); }
        });
        return { dispose: () => providers.delete(scheme) };
      },
    },
    window: {
      tabGroups: {
        all: [group], activeTabGroup: group,
        onDidChangeTabs: changedTabs.event, onDidChangeTabGroups: changedGroups.event,
        async close(tabs: any | any[]) {
          const closed = Array.isArray(tabs) ? tabs : [tabs];
          group.tabs = group.tabs.filter(tab => !closed.includes(tab));
          group.activeTab = group.tabs.at(-1);
          changedTabs.fire({ closed, opened: [], changed: [] });
          return true;
        },
      },
      onDidChangeActiveTextEditor: changedEditor.event,
      createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      showWarningMessage: async (message: string) => { warnings.push(message); },
      createOutputChannel: () => ({
        clear: () => { output.lines = []; }, appendLine: (line: string) => output.lines.push(line),
        show: () => output.shown++, dispose() {},
      }),
      createQuickPick: () => {
        const selection = new Emitter<any>();
        const trigger = new Emitter<any>();
        const accept = new Emitter<any>();
        const hide = new Emitter<any>();
        const picker = {
          items: [] as any[], selectedItems: [] as any[],
          onDidChangeSelection: selection.event, onDidTriggerButton: trigger.event,
          onDidAccept: accept.event, onDidHide: hide.event,
          selection, trigger, accept, show() {}, hide: () => hide.fire(undefined), dispose() {},
        };
        pickers.push(picker);
        return picker;
      },
    },
    env: { clipboard: { writeText: async (text: string) => { clipboard = text; } } },
  };
  const moduleCache = new Map<string, any>();
  function load(filename: string): any {
    if (moduleCache.has(filename)) { return moduleCache.get(filename); }
    const mod = { exports: {} };
    moduleCache.set(filename, mod.exports);
    const localRequire = createRequire(filename);
    const wrappedRequire = (name: string) => {
      if (name === 'vscode') { return api; }
      const resolved = localRequire.resolve(name);
      if (resolved.endsWith(`${path.sep}changelog.js`)) { return load(resolved); }
      return localRequire(name);
    };
    const wrapper = vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
    wrapper(wrappedRequire, mod, mod.exports);
    moduleCache.set(filename, mod.exports);
    return mod.exports;
  }
  const review = load(require.resolve('../../ui/diff')) as typeof Review;
  review.registerReviewCommands({ subscriptions } as any);
  const run = (action: string, target?: unknown) => commands.get(`deslop.review.${action}`)?.(target);
  return {
    review, group, run, providers, contexts, warnings, output, pickers, commands,
    get clipboard() { return clipboard; }, get diffCalls() { return diffCalls; },
    getPreview: () => providers.get('deslop-review').provideTextDocumentContent(group.tabs.find(tab => tab.input.modified.toString().includes('selected-read-only')).input.modified),
    close: () => api.window.tabGroups.close(group.tabs.find(tab => tab.input.modified.toString().includes('selected-read-only'))),
    closeGroupOnly: () => { group.tabs = []; group.activeTab = undefined; changedGroups.fire(undefined); },
    switchAway: () => { group.activeTab = { input: {} }; changedTabs.fire({ closed: [], opened: [], changed: [] }); },
    failNextOpen: () => { failOpen = true; },
    delayUpdates: () => { delayed = true; },
    acknowledge: () => { for (const uri of models.keys()) { models.set(uri, providers.get('deslop-review').provideTextDocumentContent(Uri.parse(uri))); } },
    dispose: () => { for (const subscription of [...subscriptions].reverse()) { subscription.dispose(); } },
    loadChangelog: () => load(require.resolve('../../ui/changelog')) as typeof import('../../ui/changelog'),
  };
}

suite('review UI lifecycle — public API fakes', () => {
  const request = { original: 'one\nanchor\nthree', rewritten: 'ONE\nanchor\nTHREE', changes: [{ pattern: 'padding', action: 'removed' }] };

  test('stable commands; exact selected read-only preview and structured result; no automatic clipboard or panel', async () => {
    const h = harness();
    const registered = h.commands.size;
    const pending = h.review.showReview(request);
    await Promise.resolve();
    assert.strictEqual(h.contexts.get('deslop.reviewActive'), true);
    assert.match(h.group.tabs[0].input.modified.toString(), /^deslop-review:/);
    assert.strictEqual(h.getPreview(), request.rewritten);
    await h.run('selectGroups');
    const picker = h.pickers[0];
    assert.strictEqual(picker.items.length, 2);
    picker.selection.fire([picker.items[1]]);
    assert.strictEqual(h.getPreview(), 'one\nanchor\nTHREE');
    assert.strictEqual(h.clipboard, '');
    assert.strictEqual(h.output.shown, 0);
    await h.run('copyResult');
    assert.strictEqual(h.clipboard, 'one\nanchor\nTHREE');
    await h.run('showChanges');
    assert.strictEqual(h.output.shown, 1);
    assert.ok(h.output.lines.some(line => /FULL proposal/.test(line)));
    await h.run('applySelected');
    const result = await pending;
    assert.strictEqual(result.kind, 'apply');
    if (result.kind === 'apply') {
      assert.strictEqual(result.text, 'one\nanchor\nTHREE');
      assert.deepStrictEqual(result.summary.selectedGroupIds, ['group-2']);
      assert.strictEqual(result.summary.fullRewrite, false);
    }
    assert.strictEqual(h.commands.size, registered);
    assert.strictEqual(h.contexts.get('deslop.reviewAvailable'), false);
    assert.strictEqual(h.group.tabs.length, 0);
    h.dispose();
    assert.strictEqual(h.commands.size, 0);
    assert.strictEqual(h.providers.size, 0);
  });

  test('close settles discard; commands cannot revive or accept stale sessions', async () => {
    const h = harness();
    const pending = h.review.showReview(request);
    await h.close();
    assert.deepStrictEqual(await pending, { kind: 'discard' });
    await h.run('applySelected');
    await h.review.returnToReview();
    assert.strictEqual(h.group.tabs.length, 0);
    h.dispose();
  });

  test('group-only closure without a tab-closed event still settles review', async () => {
    const h = harness();
    const pending = h.review.showReview(request);
    await h.review.returnToReview();
    h.closeGroupOnly();
    assert.deepStrictEqual(await pending, { kind: 'discard' });
    h.dispose();
  });

  test('failed picker return is handled and retains safe recovery actions', async () => {
    const h = harness();
    const pending = h.review.showReview(request);
    await h.run('selectGroups');
    h.failNextOpen();
    h.pickers[0].accept.fire(undefined);
    await Promise.resolve(); await Promise.resolve();
    assert.ok(h.warnings.some(message => /could not be reopened/.test(message)));
    h.review.cancelReview();
    await pending;
    h.dispose();
  });

  test('tab switching removes scoped context; palette apply returns to review before allowing acceptance', async () => {
    const h = harness();
    const pending = h.review.showReview(request);
    h.switchAway();
    assert.strictEqual(h.contexts.get('deslop.reviewActive'), false);
    await h.run('applySelected');
    assert.strictEqual(h.contexts.get('deslop.reviewActive'), true);
    assert.strictEqual(h.contexts.get('deslop.reviewAvailable'), true);
    await h.run('applySelected');
    assert.strictEqual((await pending).kind, 'apply');
    h.dispose();
  });

  test('overlap rejected; stale command tokens and unrelated URI actions ignored; discard wins race', async () => {
    const h = harness();
    const pending = h.review.showReview(request);
    await assert.rejects(h.review.showReview(request), /already active/);
    await h.run('discard', 'stale-session-token');
    await h.run('applySelected', Uri.parse('file:/unrelated'));
    assert.strictEqual(h.contexts.get('deslop.reviewAvailable'), true);
    await h.run('discard');
    await h.run('acceptAll');
    assert.deepStrictEqual(await pending, { kind: 'discard' });
    h.dispose();
  });

  test('none, all, full proposal inspection, cancellation and disposal stay coherent', async () => {
    const h = harness();
    let pending = h.review.showReview(request);
    await h.run('selectNone');
    assert.strictEqual(h.getPreview(), request.original);
    await h.run('showFullProposal');
    assert.strictEqual(h.group.tabs.length, 2);
    await h.run('applySelected'); // full proposal tab first returns to selected preview
    await h.run('applySelected');
    let result = await pending;
    assert.strictEqual(result.kind, 'apply');
    if (result.kind === 'apply') {
      assert.strictEqual(result.text, request.original);
      assert.strictEqual(result.summary.selectedGroups, 0);
    }
    pending = h.review.showReview(request);
    await h.run('selectNone');
    await h.run('acceptAll');
    result = await pending;
    assert.strictEqual(result.kind, 'apply');
    if (result.kind === 'apply') { assert.strictEqual(result.text, request.rewritten); }
    pending = h.review.showReview(request);
    h.review.cancelReview();
    assert.deepStrictEqual(await pending, { kind: 'discard' });
    pending = h.review.showReview(request);
    h.dispose();
    assert.deepStrictEqual(await pending, { kind: 'discard' });
  });

  test('rapid selection then apply cannot outrun the native preview model', async () => {
    const h = harness();
    const pending = h.review.showReview(request);
    await Promise.resolve();
    h.delayUpdates();
    await h.run('selectNone');
    await h.run('applySelected');
    assert.strictEqual(h.contexts.get('deslop.reviewAvailable'), true);
    assert.ok(h.warnings.length > 0);
    h.acknowledge();
    await h.run('applySelected');
    const result = await pending;
    assert.strictEqual(result.kind, 'apply');
    if (result.kind === 'apply') { assert.strictEqual(result.text, request.original); }
    h.dispose();
  });

  test('accept-all after a subset waits for its exact updated native preview', async () => {
    const h = harness();
    const pending = h.review.showReview(request);
    await Promise.resolve();
    await h.run('selectNone');
    h.delayUpdates();
    await h.run('acceptAll');
    assert.strictEqual(h.contexts.get('deslop.reviewAvailable'), true);
    assert.ok(h.warnings.some(message => /not yet identical/.test(message)));
    h.acknowledge();
    await h.run('applySelected');
    const result = await pending;
    assert.strictEqual(result.kind, 'apply');
    if (result.kind === 'apply') { assert.strictEqual(result.text, request.rewritten); }
    h.dispose();
  });

  test('invalid subset cannot change preview or silently clean excluded source', async () => {
    const h = harness();
    const pending = h.review.showReview({ original: 'bad\u200b\nanchor\nold', rewritten: 'bad\nanchor\nnew' });
    await h.run('selectGroups');
    const picker = h.pickers[0];
    picker.selection.fire([picker.items[1]]);
    assert.strictEqual(h.getPreview(), 'bad\nanchor\nnew');
    assert.strictEqual(h.warnings.length, 1);
    await h.run('selectNone');
    assert.strictEqual(h.getPreview(), 'bad\u200b\nanchor\nold');
    h.review.cancelReview();
    await pending;
    h.dispose();
  });

  test('open failure releases resources and pending ownership; invalid full proposal never opens', async () => {
    const h = harness();
    await assert.rejects(h.review.showReview({ original: '`code`', rewritten: 'missing' }), /validation/);
    assert.strictEqual(h.diffCalls, 0);
    h.failNextOpen();
    await assert.rejects(h.review.showReview(request), /mock editor failure/);
    assert.strictEqual(h.contexts.get('deslop.reviewAvailable'), false);
    h.dispose();
  });

  test('last explanations remain independent of pending explanations, optional panel, honest empty/subset labels', () => {
    const h = harness();
    const changes = h.loadChangelog();
    changes.logChanges([], 'README', { summary: { selectedGroupIds: ['group-2'], selectedGroups: 1, totalGroups: 2, fullRewrite: false } });
    assert.strictEqual(h.output.shown, 0);
    changes.showReviewChanges([{ pattern: 'current', action: 'pending' }]);
    changes.showChangelog();
    assert.ok(h.output.lines.some(line => /No model explanations/.test(line)));
    assert.ok(h.output.lines.some(line => /may describe excluded/.test(line)));
    assert.ok(!h.output.lines.some(line => /current/.test(line)));
    changes.logChanges([], 'README', { show: true });
    assert.strictEqual(h.output.shown, 3);
    changes.disposeChannel();
    h.dispose();
  });
});
