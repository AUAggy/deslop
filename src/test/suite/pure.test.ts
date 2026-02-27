import * as assert from 'assert';
import { isCommentOrStringLine } from '../../util/isProseSelection';
import { isSelectionTooLong, MAX_CHARS } from '../../api/providers';
import { approximateWordCount } from '../../commands/humanize';

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
