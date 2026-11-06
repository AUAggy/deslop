// Headless adapter for the scoped editorial suite only. No editor or network is started.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const writes = [];
const globals = new Map();
const config = {
  inspect: key => ({ globalValue: globals.get(key), workspaceValue: true, globalLanguageValue: true }),
  update: async (key, value, target) => { writes.push({ key, value, target }); },
};
let pickerCall = 0;
const vscode = {
  ConfigurationTarget: { Global: 1 },
  workspace: { getConfiguration: section => { assert.equal(section, 'deslop'); return config; } },
  window: {
    showQuickPick: async items => ++pickerCall === 1 ? items[0] : [items[1]],
  },
};
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args);
};
global.suite = describe;
global.test = it;
try {
  require('../out/test/suite/editorial.test.js');
  const settings = require('../out/editorial/settings.js');
  describe('Editorial native user-scope wrappers', () => {
    it('reads explicit global only and writes remembered choice at Global scope', async () => {
      assert.equal(settings.readRememberDocumentType(), false);
      globals.set('rememberDocumentType', true);
      assert.equal(settings.readRememberDocumentType(), true);
      globals.set('preservePunctuationStyle', true);
      assert.deepEqual(settings.readEditorialPreferences(), { preservePunctuationStyle: true, preserveParagraphListStructure: false });
      await settings.setRememberDocumentType(true);
      assert.deepEqual(writes, [{ key: 'rememberDocumentType', value: true, target: 1 }]);
    });
    it('native explicit preference saves write only Global scope', async () => {
      writes.length = 0;
      globals.clear();
      assert.equal(await settings.configureEditorialPreferences(), true);
      assert.deepEqual(writes, [{ key: 'preserveParagraphListStructure', value: true, target: 1 }]);
    });
  });
} finally {
  Module._load = originalLoad;
  delete global.suite;
  delete global.test;
}
