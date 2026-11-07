import * as assert from 'assert';
import { resolveEditorialPreferences, buildPreferenceInstructions, describeEditorialPreferences } from '../../editorial/preferences';
import { resolveDocumentType, orderedDocumentTypes, DOCUMENT_TYPES } from '../../editorial/documentType';
import { configureEditorialPreferences, type PreferenceSettingsUI } from '../../editorial/settings';

suite('Editorial preferences', () => {
  test('only explicit global booleans enable preferences', () => {
    const ignored = { defaultValue: true, workspaceValue: true, workspaceFolderValue: true, globalLanguageValue: true };
    const off = resolveEditorialPreferences({ inspect: () => ignored as { globalValue?: unknown } });
    assert.deepStrictEqual(off, { preservePunctuationStyle: false, preserveParagraphListStructure: false });
    assert.strictEqual(buildPreferenceInstructions(off), '');
    assert.strictEqual(Object.isFrozen(off), true);
    for (const value of [undefined, false, 'true', 1, null]) {
      assert.strictEqual(resolveEditorialPreferences({ inspect: () => ({ globalValue: value }) }).preservePunctuationStyle, false);
    }
  });

  test('independent combinations produce bounded instructions and captured descriptions', () => {
    for (const punctuation of [false, true]) {
      for (const structure of [false, true]) {
        const preferences = resolveEditorialPreferences({ inspect: key => ({ globalValue: key === 'preservePunctuationStyle' ? punctuation : structure }) });
        const instructions = buildPreferenceInstructions(preferences);
        assert.strictEqual(instructions.includes('legitimate punctuation style'), punctuation);
        assert.strictEqual(instructions.includes('paragraph boundaries'), structure);
        if (punctuation || structure) {
          for (const phrase of ['Meaning', 'protected content', 'document-type requirements', 'mechanical output-integrity', 'invisible or confusable']) {
            assert.ok(instructions.includes(phrase));
          }
        }
        assert.ok(describeEditorialPreferences(preferences).includes(punctuation ? 'Punctuation style: preserve' : 'Punctuation style: default'));
      }
    }
  });

  test('settings changes cannot mutate the captured preference snapshot', () => {
    let enabled = true;
    const inspector = { inspect: () => ({ globalValue: enabled }) };
    const captured = resolveEditorialPreferences(inspector);
    enabled = false;
    assert.strictEqual(captured.preservePunctuationStyle, true);
    assert.strictEqual(resolveEditorialPreferences(inspector).preservePunctuationStyle, false);
  });

  test('cancel action and cancel picker write nothing', async () => {
    const writes: string[] = [];
    const ui: PreferenceSettingsUI = {
      read: () => ({ preservePunctuationStyle: false, preserveParagraphListStructure: false }),
      chooseAction: async () => undefined,
      choose: async () => undefined,
      write: async key => { writes.push(key); },
    };
    assert.strictEqual(await configureEditorialPreferences(ui), false);
    ui.chooseAction = async () => 'edit';
    assert.strictEqual(await configureEditorialPreferences(ui), false);
    assert.deepStrictEqual(writes, []);
  });

  test('explicit choices independently save, reset disables both, failure propagates', async () => {
    const writes: Array<[string, boolean]> = [];
    const ui: PreferenceSettingsUI = {
      read: () => ({ preservePunctuationStyle: false, preserveParagraphListStructure: false }),
      chooseAction: async () => 'edit',
      choose: async items => [items[1]],
      write: async (key, value) => { writes.push([key, value]); },
    };
    assert.strictEqual(await configureEditorialPreferences(ui), true);
    assert.deepStrictEqual(writes, [['preserveParagraphListStructure', true]]);
    writes.length = 0;
    ui.read = () => ({ preservePunctuationStyle: true, preserveParagraphListStructure: true });
    ui.chooseAction = async () => 'reset';
    await configureEditorialPreferences(ui);
    assert.deepStrictEqual(writes, [['preservePunctuationStyle', false], ['preserveParagraphListStructure', false]]);
    ui.write = async () => { throw new Error('storage failure'); };
    await assert.rejects(configureEditorialPreferences(ui), /storage failure/);
  });
});

suite('Conservative document type resolution', () => {
  test('explicit valid default wins all other hints', () => {
    assert.deepStrictEqual(resolveDocumentType({ defaultDocumentType: 'Blog/Article', fileName: 'README.md', isCodeComment: true, languageId: 'git-commit', rememberDocumentType: true, lastDocumentType: 'Commit Message' }), { type: 'Blog/Article', source: 'default' });
  });
  test('recognised README case and extension variants only', () => {
    for (const name of ['README', 'ReadMe.MD', 'readme.markdown', 'README.mdown', 'README.mkd', 'README.rst', 'README.txt', 'C:\\repo\\README.md']) {
      assert.strictEqual(resolveDocumentType({ fileName: name }).source, 'readme', name);
    }
    for (const name of ['article.md', 'readme-notes.md', 'README.md.bak', 'README.fr.md', 'README.html', '']) {
      assert.strictEqual(resolveDocumentType({ fileName: name }).source, 'picker', name);
    }
  });
  test('source comment and recognised commit contexts beat remembered choice', () => {
    assert.strictEqual(resolveDocumentType({ isCodeComment: true, lastDocumentType: 'README', rememberDocumentType: true }).type, 'Docstring/Comment');
    for (const name of ['COMMIT_EDITMSG', 'MERGE_MSG', 'TAG_EDITMSG', 'SQUASH_MSG']) {
      assert.strictEqual(resolveDocumentType({ fileName: `/repo/.git/${name}` }).type, 'Commit Message');
    }
    assert.strictEqual(resolveDocumentType({ languageId: 'git-commit' }).source, 'commit');
    assert.strictEqual(resolveDocumentType({ fileName: 'commit.md' }).source, 'picker');
  });
  test('reuse requires explicit enable and valid remembered value; otherwise ordering only', () => {
    for (const type of DOCUMENT_TYPES) {
      assert.strictEqual(resolveDocumentType({ lastDocumentType: type }).source, 'picker');
      assert.strictEqual(resolveDocumentType({ lastDocumentType: type, rememberDocumentType: true }).type, type);
      assert.strictEqual(orderedDocumentTypes(type)[0], type);
      assert.strictEqual(new Set(orderedDocumentTypes(type)).size, 4);
    }
    for (const invalid of [null, undefined, 'unknown', {}, 1]) {
      assert.strictEqual(resolveDocumentType({ defaultDocumentType: invalid, lastDocumentType: invalid, rememberDocumentType: true }).source, 'picker');
      assert.deepStrictEqual(orderedDocumentTypes(invalid), DOCUMENT_TYPES);
    }
  });
});
