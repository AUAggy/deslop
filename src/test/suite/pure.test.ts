import * as assert from 'assert';
import * as vscode from 'vscode';
import { isCommentOrStringLine, isProseSelection, isCodeCommentSelection, nextBlockState, detectOpenBlockAbove } from '../../util/isProseSelection';
import { isSelectionTooLong, MAX_CHARS, sanitiseChanges } from '../../api/providers';
import { approximateWordCount } from '../../commands/humanize';
import { MODIFIERS } from '../../prompts/modifiers';
import { SYSTEM_PROMPT } from '../../prompts/system';

// ---------------------------------------------------------------------------
// Minimal VS Code fakes for pure-function tests
// ---------------------------------------------------------------------------

function mockDoc(lines: string[], fileName = 'test.py', languageId = 'python'): vscode.TextDocument {
  return {
    fileName,
    languageId,
    isUntitled: false,
    lineAt: (n: number) => ({ text: lines[n] }),
  } as unknown as vscode.TextDocument;
}

function mockSel(startLine: number, endLine: number, endCharacter = 0): vscode.Selection {
  return {
    start: { line: startLine, character: 0 },
    end: { line: endLine, character: endCharacter },
  } as unknown as vscode.Selection;
}

// ---------------------------------------------------------------------------

suite('isCommentOrStringLine', () => {
  test('recognises // line comments', () => {
    assert.strictEqual(isCommentOrStringLine('// This is a comment'), true);
  });

  test('recognises # line comments', () => {
    assert.strictEqual(isCommentOrStringLine('# Python comment'), true);
  });

  test('recognises * JSDoc lines', () => {
    assert.strictEqual(isCommentOrStringLine('* @param foo the foo value'), true);
  });

  test('recognises /* block comment openers', () => {
    assert.strictEqual(isCommentOrStringLine('/* start of block'), true);
  });

  test('recognises Python docstring openers', () => {
    assert.strictEqual(isCommentOrStringLine('"""Docstring text"""'), true);
  });

  test('recognises single-quote Python docstrings', () => {
    assert.strictEqual(isCommentOrStringLine("'''Docstring text'''"), true);
  });

  test('recognises SQL -- comments', () => {
    assert.strictEqual(isCommentOrStringLine('-- SELECT comment'), true);
  });

  test('recognises HTML <!-- comments', () => {
    assert.strictEqual(isCommentOrStringLine('<!-- html comment -->'), true);
  });

  test('recognises Rust //! doc comments', () => {
    assert.strictEqual(isCommentOrStringLine('//! Rust doc comment'), true);
  });

  test('recognises PowerShell <# opener', () => {
    assert.strictEqual(isCommentOrStringLine('<# block comment'), true);
  });

  test('recognises PowerShell #> closer', () => {
    assert.strictEqual(isCommentOrStringLine('#> end of block'), true);
  });

  test('rejects plain code lines', () => {
    assert.strictEqual(isCommentOrStringLine('const x = 42;'), false);
  });

  test('rejects function declarations', () => {
    assert.strictEqual(isCommentOrStringLine('function doThing() {'), false);
  });

  test('rejects import statements', () => {
    assert.strictEqual(isCommentOrStringLine('import { foo } from bar'), false);
  });
});

// ---------------------------------------------------------------------------

suite('isProseSelection — block comment interiors', () => {
  test('accepts Python docstring with plain interior lines', async () => {
    const doc = mockDoc(['    """', '    Filters the list.', '    Uses the batch predicate.', '    """']);
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 3)), true);
  });

  test('accepts single-line """ docstring', async () => {
    const doc = mockDoc(['"""Inline docstring."""']);
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 0)), true);
  });

  test('accepts opening """ with content then closing on separate line', async () => {
    const doc = mockDoc(['"""', 'Describe the thing.', '"""']);
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 2)), true);
  });

  test('accepts single-quoted Python docstring with interior lines', async () => {
    const doc = mockDoc(["'''", 'Interior line.', "'''"], 'test.py');
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 2)), true);
  });

  test('accepts PowerShell <# block with interior lines', async () => {
    const doc = mockDoc(['<#', '.SYNOPSIS', 'Connects to the server.', '#>'], 'script.ps1');
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 3)), true);
  });

  test('accepts PowerShell <# block without closing #> in selection', async () => {
    const doc = mockDoc(['<#', '.SYNOPSIS', 'Connects to the server.'], 'script.ps1');
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 2)), true);
  });

  test('rejects mixed comment and code lines', async () => {
    const doc = mockDoc(['# comment', 'const x = 1;'], 'index.ts', 'typescript');
    // endCharacter > 0 so the code line is included in the selection
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 1, 5)), false);
  });

  test('rejects selection with no prose lines (all empty)', async () => {
    const doc = mockDoc(['', '   ', '']);
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 2)), false);
  });

  test('accepts .md file regardless of line content', async () => {
    const doc = mockDoc(['const x = 1;'], 'readme.md');
    assert.strictEqual(await isProseSelection(doc, mockSel(0, 0)), true);
  });
});

// ---------------------------------------------------------------------------

suite('isCodeCommentSelection', () => {
  test('returns true for // comment lines in a .ts file', async () => {
    const doc = mockDoc(['// comment line'], 'index.ts');
    assert.strictEqual(await isCodeCommentSelection(doc, mockSel(0, 0)), true);
  });

  test('returns true for Python docstring interior in a .py file', async () => {
    const doc = mockDoc(['"""', 'Describe it.', '"""'], 'util.py');
    assert.strictEqual(await isCodeCommentSelection(doc, mockSel(0, 2)), true);
  });

  test('returns false for a .md file', async () => {
    const doc = mockDoc(['# Heading'], 'README.md');
    assert.strictEqual(await isCodeCommentSelection(doc, mockSel(0, 0)), false);
  });

  test('returns false for a .txt file', async () => {
    const doc = mockDoc(['// looks like code'], 'notes.txt');
    assert.strictEqual(await isCodeCommentSelection(doc, mockSel(0, 0)), false);
  });

  test('returns false for code lines in a .ts file', async () => {
    const doc = mockDoc(['const x = 1;'], 'index.ts');
    assert.strictEqual(await isCodeCommentSelection(doc, mockSel(0, 0)), false);
  });

  test('returns false for untitled document', async () => {
    const doc = { fileName: 'Untitled-1', isUntitled: true, lineAt: (n: number) => ({ text: ['// comment'][n] }) } as unknown as vscode.TextDocument;
    assert.strictEqual(await isCodeCommentSelection(doc, mockSel(0, 0)), false);
  });

  test('returns false for extensionless prose filename (license)', async () => {
    const doc = mockDoc(['// comment'], '/project/LICENSE');
    assert.strictEqual(await isCodeCommentSelection(doc, mockSel(0, 0)), false);
  });
});

// ---------------------------------------------------------------------------

suite('isSelectionTooLong', () => {
  test('returns false for short text', () => {
    assert.strictEqual(isSelectionTooLong('hello world'), false);
  });

  test('returns false for text just under the limit', () => {
    const text = 'a'.repeat(MAX_CHARS - 1);
    assert.strictEqual(isSelectionTooLong(text), false);
  });

  test('returns false for text exactly at the limit', () => {
    const text = 'a'.repeat(MAX_CHARS);
    assert.strictEqual(isSelectionTooLong(text), false);
  });

  test('returns true for text over the limit', () => {
    const text = 'a'.repeat(MAX_CHARS + 1000);
    assert.strictEqual(isSelectionTooLong(text), true);
  });
});

// ---------------------------------------------------------------------------

suite('approximateWordCount', () => {
  test('counts single words', () => {
    assert.strictEqual(approximateWordCount('hello'), 1);
  });

  test('counts multiple words', () => {
    assert.strictEqual(approximateWordCount('one two three'), 3);
  });

  test('handles extra whitespace', () => {
    assert.strictEqual(approximateWordCount('  one   two  '), 2);
  });

  test('handles empty string', () => {
    assert.strictEqual(approximateWordCount(''), 0);
  });

  test('handles newlines between words', () => {
    assert.strictEqual(approximateWordCount('line one\nline two'), 4);
  });
});

// ---------------------------------------------------------------------------

suite('SYSTEM_PROMPT — code region preservation rule', () => {
  test('contains triple-backtick fence preservation rule', () => {
    assert.ok(
      SYSTEM_PROMPT.includes('```') || SYSTEM_PROMPT.toLowerCase().includes('backtick') || SYSTEM_PROMPT.toLowerCase().includes('fence'),
      'Expected SYSTEM_PROMPT to mention backtick fences'
    );
  });

  test('contains inline code preservation rule', () => {
    assert.ok(
      SYSTEM_PROMPT.toLowerCase().includes('inline') || SYSTEM_PROMPT.toLowerCase().includes('backtick span'),
      'Expected SYSTEM_PROMPT to mention inline code'
    );
  });

  test('contains frontmatter preservation rule', () => {
    assert.ok(
      SYSTEM_PROMPT.toLowerCase().includes('frontmatter') || SYSTEM_PROMPT.includes('---'),
      'Expected SYSTEM_PROMPT to mention frontmatter'
    );
  });

  test('preservation rule appears before STYLE RULES section', () => {
    const codeRegionIdx = SYSTEM_PROMPT.indexOf('CODE REGION');
    const styleRulesIdx = SYSTEM_PROMPT.indexOf('STYLE RULES');
    assert.ok(codeRegionIdx !== -1, 'CODE REGION section not found');
    assert.ok(styleRulesIdx !== -1, 'STYLE RULES section not found');
    assert.ok(codeRegionIdx < styleRulesIdx, 'CODE REGION should appear before STYLE RULES');
  });
});

// ---------------------------------------------------------------------------

suite("MODIFIERS['Docstring/Comment'] — content assertions", () => {
  const modifier = MODIFIERS['Docstring/Comment'];

  test('contains structural preservation rule', () => {
    assert.ok(
      modifier.toLowerCase().includes('preserve'),
      'Expected modifier to contain preservation rule'
    );
  });

  test('contains preamble-cutting rule', () => {
    assert.ok(
      modifier.includes('This function') || modifier.includes('This method'),
      'Expected modifier to mention preamble patterns to cut'
    );
  });

  test('contains at least one AI docstring banned pattern', () => {
    assert.ok(
      modifier.includes('responsible for') || modifier.includes('takes care of') || modifier.includes('Provides a way to'),
      'Expected modifier to list banned AI docstring patterns'
    );
  });

  test('contains @param constraint guidance', () => {
    assert.ok(modifier.includes('@param'), 'Expected modifier to mention @param');
  });

  test('contains imperative mood rule', () => {
    assert.ok(
      modifier.toLowerCase().includes('imperative'),
      'Expected modifier to mention imperative mood'
    );
  });

  test('is substantially longer than the old two-line version', () => {
    assert.ok(modifier.length > 200, `Expected modifier length > 200, got ${modifier.length}`);
  });

  test('does not introduce new keys into MODIFIERS', () => {
    assert.deepStrictEqual(
      Object.keys(MODIFIERS),
      ['README', 'Docstring/Comment', 'Commit Message', 'Blog/Article']
    );
  });
});

// ---------------------------------------------------------------------------

suite('nextBlockState', () => {
  test('opens """ block', () => {
    assert.strictEqual(nextBlockState('"""hello', null), '"""');
  });

  test('opens and closes """ on the same line', () => {
    assert.strictEqual(nextBlockState('"""hello"""', null), null);
  });

  test('closes existing """ block', () => {
    assert.strictEqual(nextBlockState('end"""', '"""'), null);
  });

  test("opens ''' block", () => {
    assert.strictEqual(nextBlockState("'''hello", null), "'''");
  });

  test("opens and closes ''' on the same line", () => {
    assert.strictEqual(nextBlockState("'''hello'''", null), null);
  });

  test('asymmetric <# opens', () => {
    assert.strictEqual(nextBlockState('<# foo', null), '<#');
  });

  test('asymmetric #> closes', () => {
    assert.strictEqual(nextBlockState('bar #>', '<#'), null);
  });

  test('plain code line preserves null state', () => {
    assert.strictEqual(nextBlockState('const x = 1;', null), null);
  });

  test('plain interior line preserves open block state', () => {
    assert.strictEqual(nextBlockState('Interior prose line.', '"""'), '"""');
  });
});

// ---------------------------------------------------------------------------

suite('detectOpenBlockAbove', () => {
  test('returns null when no block is open above', () => {
    const doc = mockDoc(['def f():', '    x = 1'], 'mod.py', 'python');
    assert.strictEqual(detectOpenBlockAbove(doc, 0), null);
  });

  test('returns """ when block is open above selection', () => {
    const doc = mockDoc([
      'def f():',
      '    """',
      '    Interior line.',
      '    """',
    ], 'mod.py', 'python');
    // startLine=2 — the opener is on line 1, not yet closed by line 2
    assert.strictEqual(detectOpenBlockAbove(doc, 2), '"""');
  });

  test('returns null when block opened and closed above selection', () => {
    const doc = mockDoc([
      '"""',
      'closed here"""',
      'more code',
    ], 'mod.py', 'python');
    assert.strictEqual(detectOpenBlockAbove(doc, 2), null);
  });
});

// ---------------------------------------------------------------------------

suite('isProseSelection — interior block detection (#4)', () => {
  test('interior-only lines of an open """ docstring are prose', async () => {
    const doc = mockDoc([
      'def f():',
      '    """',
      '    Filters the list.',
      '    Returns sorted results.',
      '    """',
      '    return sorted(x)',
    ], 'mod.py', 'python');
    const sel = mockSel(2, 3, 30);
    assert.strictEqual(await isProseSelection(doc, sel), true);
  });

  test('interior of PowerShell <# ... #> block is prose', async () => {
    const doc = mockDoc([
      '<#',
      '  Synopsis: does the thing.',
      '#>',
      'function Foo {}',
    ], 'a.ps1', 'powershell');
    const sel = mockSel(1, 1, 30);
    assert.strictEqual(await isProseSelection(doc, sel), true);
  });

  test('same-line """foo""" does not leave block open for next line', async () => {
    const doc = mockDoc([
      '"""one-liner"""',
      'code_line = 1',
    ], 'mod.py', 'python');
    const sel = mockSel(1, 1, 5);
    assert.strictEqual(await isProseSelection(doc, sel), false);
  });
});

// ---------------------------------------------------------------------------

suite('isProseSelection — end-at-col-0 boundary (#5)', () => {
  test('selection ending at col 0 of next code line ignores that line', async () => {
    const doc = mockDoc([
      '// comment one',
      '// comment two',
      'const x = 1;',
    ], 'a.ts', 'typescript');
    const sel = mockSel(0, 2, 0);
    assert.strictEqual(await isProseSelection(doc, sel), true);
  });

  test('selection ending mid-code-line still inspects that line', async () => {
    const doc = mockDoc([
      '// comment',
      'const x = 1;',
    ], 'a.ts', 'typescript');
    const sel = mockSel(0, 1, 5);
    assert.strictEqual(await isProseSelection(doc, sel), false);
  });

  test('single-line selection at col 0 is not adjusted (start===end)', async () => {
    const doc = mockDoc(['// comment'], 'a.ts', 'typescript');
    const sel = mockSel(0, 0, 0);
    assert.strictEqual(await isProseSelection(doc, sel), true);
  });
});

// ---------------------------------------------------------------------------

suite('isProseSelection — language-aware # (#6)', () => {
  test('#include in a .c file is rejected', async () => {
    const doc = mockDoc([
      '#include <stdio.h>',
      '#define SIZE 8',
    ], 'main.c', 'c');
    const sel = mockSel(0, 1, 10);
    assert.strictEqual(await isProseSelection(doc, sel), false);
  });

  test('# comment in a Python file is accepted', async () => {
    const doc = mockDoc([
      '# a real comment',
      '# another',
    ], 'a.py', 'python');
    const sel = mockSel(0, 1, 5);
    assert.strictEqual(await isProseSelection(doc, sel), true);
  });

  test('#pragma in cpp is rejected', async () => {
    const doc = mockDoc(['#pragma once'], 'a.cpp', 'cpp');
    const sel = mockSel(0, 0, 5);
    assert.strictEqual(await isProseSelection(doc, sel), false);
  });

  test('# in objective-c is rejected', async () => {
    const doc = mockDoc(['#import <Foundation/Foundation.h>'], 'a.m', 'objective-c');
    const sel = mockSel(0, 0, 5);
    assert.strictEqual(await isProseSelection(doc, sel), false);
  });

  test('#if in csharp is rejected', async () => {
    const doc = mockDoc(['#if DEBUG', '#endif'], 'a.cs', 'csharp');
    const sel = mockSel(0, 1, 6);
    assert.strictEqual(await isProseSelection(doc, sel), false);
  });
});

// ---------------------------------------------------------------------------

suite('isCommentOrStringLine — language-aware # (#6)', () => {
  test('# without languageId is accepted (backwards compat)', () => {
    assert.strictEqual(isCommentOrStringLine('# comment'), true);
  });

  test('# with python languageId is accepted', () => {
    assert.strictEqual(isCommentOrStringLine('# comment', 'python'), true);
  });

  test('# with c languageId is rejected', () => {
    assert.strictEqual(isCommentOrStringLine('#include <stdio.h>', 'c'), false);
  });

  test('# with cpp languageId is rejected', () => {
    assert.strictEqual(isCommentOrStringLine('#define MAX 9', 'cpp'), false);
  });

  test('# with ruby languageId is accepted', () => {
    assert.strictEqual(isCommentOrStringLine('# ruby comment', 'ruby'), true);
  });

  test('# with shellscript languageId is accepted', () => {
    assert.strictEqual(isCommentOrStringLine('# shell comment', 'shellscript'), true);
  });

  test('# with csharp languageId is rejected', () => {
    assert.strictEqual(isCommentOrStringLine('#if DEBUG', 'csharp'), false);
  });
});

// ---------------------------------------------------------------------------

suite('sanitiseChanges (#3)', () => {
  test('drops null entries', () => {
    assert.deepStrictEqual(sanitiseChanges([null]), []);
  });

  test('drops entries with non-string pattern', () => {
    assert.deepStrictEqual(sanitiseChanges([{ pattern: 1, action: 'x' }]), []);
  });

  test('drops entries missing action', () => {
    assert.deepStrictEqual(sanitiseChanges([{ pattern: 'p' }]), []);
  });

  test('keeps well-formed entries', () => {
    const ok = [{ pattern: 'p', action: 'a' }];
    assert.deepStrictEqual(sanitiseChanges(ok), ok);
  });

  test('mixed input keeps only valid entries', () => {
    const result = sanitiseChanges([
      null,
      { pattern: 'p', action: 'a' },
      { pattern: 1 },
      'string',
      { pattern: 'q', action: 'b' },
    ]);
    assert.deepStrictEqual(result, [
      { pattern: 'p', action: 'a' },
      { pattern: 'q', action: 'b' },
    ]);
  });

  test('returns [] for non-array input', () => {
    assert.deepStrictEqual(sanitiseChanges(null as unknown as unknown[]), []);
    assert.deepStrictEqual(sanitiseChanges({} as unknown as unknown[]), []);
  });
});
