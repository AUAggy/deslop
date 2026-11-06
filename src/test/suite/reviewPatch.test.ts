import * as assert from 'assert';
import { composeReviewPatch, createReviewPatch, validateComposedText } from '../../review/patch';

suite('deterministic review composition', () => {
  const fixtures: [string, string][] = [
    ['', 'insert at EOF'], ['delete everything', ''], ['same', 'same'],
    ['old\nanchor\ntail', 'new\nanchor\nending'],
    ['repeat\nsame\nrepeat\nsame\nrepeat\n', 'edit\nsame\nrepeat\nsame\nend\n'],
    ['one\ntwo\nthree', 'one\ninserted\ntwo\nthree'],
    ['one\ntwo\nthree', 'one\nthree'],
    ['one\nanchor\nend', 'one!\nanchor\nend\n'],
    ['a\r\nanchor\r\nb\r\n', 'A\r\nanchor\r\nB\r\n'],
    ['a\r\nanchor\r\nb', 'A\nanchor\nB'],
    ['😀 old\nanchor\n𝄞 old', '😀 new\nanchor\n𝄞 new'],
    ['a\n\nb\n\nc', 'A\n\nB\n\nC'],
    ['first\nsecond\nanchor\nthird\nfourth', 'FIRST\nSECOND\nanchor\nTHIRD\nFOURTH'],
  ];

  for (const [index, [original, proposal]] of fixtures.entries()) {
    test(`fixture ${index}: all/none, offsets, stability and every subset`, () => {
      const patch = createReviewPatch(original, proposal);
      assert.deepStrictEqual(patch, createReviewPatch(original, proposal));
      assert.strictEqual(composeReviewPatch(patch, []).text, original);
      assert.strictEqual(composeReviewPatch(patch, patch.groups.map(g => g.id)).text, proposal);
      let lastEnd = 0;
      for (const group of patch.groups) {
        assert.ok(group.start >= lastEnd);
        assert.strictEqual(original.slice(group.start, group.end), group.before);
        assert.ok(!splitsSurrogate(original, group.start));
        assert.ok(!splitsSurrogate(original, group.end));
        assert.ok(!(original[group.start - 1] === '\r' && original[group.start] === '\n'));
        assert.ok(!(original[group.end - 1] === '\r' && original[group.end] === '\n'));
        lastEnd = group.end;
      }
      for (let mask = 0; mask < 2 ** patch.groups.length; mask++) {
        const groups = patch.groups.filter((_, i) => mask & (1 << i));
        const ids = groups.map(g => g.id);
        const composed = composeReviewPatch(patch, ids);
        assert.strictEqual(composed.text, composeReviewPatch(patch, [...ids].reverse()).text);
        // Independently compose right-to-left against original offsets.
        let expected = original;
        for (const group of [...groups].reverse()) {
          expected = expected.slice(0, group.start) + group.after + expected.slice(group.end);
        }
        assert.strictEqual(composed.text, expected);
        assert.deepStrictEqual(composed.issues, []);
        assert.strictEqual(composed.summary.selectedGroups, groups.length);
        assert.strictEqual(composed.summary.fullRewrite, groups.length === patch.groups.length);
      }
    });
  }

  test('independent line groups support include, exclude, all, none without coordinate drift', () => {
    const patch = createReviewPatch('one\nanchor\nthree\n', 'ONE LONGER\nanchor\n3\n');
    assert.strictEqual(patch.groups.length, 2);
    const [first, second] = patch.groups;
    assert.strictEqual(second.start, 11);
    assert.strictEqual(composeReviewPatch(patch, [second.id]).text, 'one\nanchor\n3\n');
    assert.strictEqual(composeReviewPatch(patch, [first.id]).text, 'ONE LONGER\nanchor\nthree\n');
    assert.strictEqual(composeReviewPatch(patch, new Set([first.id, first.id])).summary.selectedGroups, 1);
    assert.throws(() => composeReviewPatch(patch, ['not-a-group']), /Unknown/);
  });

  test('protected frontmatter, fences and inline code cannot be split into independent fragments', () => {
    for (const protectedText of ['---\ntitle: Keep\n---\n', '```ts\nconst x = 1;\n```\n', '`value`']) {
      const original = `${protectedText}\nold\nanchor\nold end`;
      const rewritten = `${protectedText}\nnew\nanchor\nnew end`;
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 1);
      assert.match(patch.groups[0].reason!, /Protected/);
      assert.strictEqual(patch.groups[0].start, 0);
      assert.strictEqual(patch.groups[0].end, original.length);
      assert.deepStrictEqual(composeReviewPatch(patch, ['group-1']).issues, []);
    }
  });

  test('dependent list/quote/heading/table and boundary edits stay grouped', () => {
    for (const original of ['- one\n- anchor\n- three', '1. one\n2. anchor\n3. three', '> one\n> anchor\n> three', '# one\nanchor\nthree', '| one |\nanchor\nthree']) {
      const patch = createReviewPatch(original, original.replace('one', 'ONE').replace('three', 'THREE'));
      assert.strictEqual(patch.groups.length, 1);
      assert.ok(patch.groups[0].reason);
    }
    const patch = createReviewPatch('old\nanchor\ntail', 'new\nextra\nanchor\nTAIL');
    assert.strictEqual(patch.groups.length, 1);
    assert.match(patch.groups[0].reason!, /Line-boundary/);
  });

  test('invalid protected composition is blocked rather than repaired', () => {
    const original = 'Keep `code` and `code`.';
    const patch = createReviewPatch(original, 'Keep `code`.');
    const result = composeReviewPatch(patch, ['group-1']);
    assert.deepStrictEqual(result.issues, ['inline code changed or missing']);
    assert.strictEqual(result.text, 'Keep `code`.');
    assert.deepStrictEqual(composeReviewPatch(patch, []).issues, []);
  });

  test('excluded integrity cleanup is never silently introduced', () => {
    const original = 'bad\u200b\nanchor\nold';
    const patch = createReviewPatch(original, 'bad\nanchor\nnew');
    assert.strictEqual(patch.groups.length, 2);
    const partial = composeReviewPatch(patch, [patch.groups[1].id]);
    assert.strictEqual(partial.text, 'bad\u200b\nanchor\nnew');
    assert.strictEqual(partial.issues.length, 1);
    assert.match(partial.issues[0], /cleanup/);
    assert.deepStrictEqual(composeReviewPatch(patch, patch.groups.map(g => g.id)).issues, []);
    assert.strictEqual(composeReviewPatch(patch, []).text, original);
  });

  test('confusable punctuation cleanup is validation-only', () => {
    assert.strictEqual(validateComposedText('a', 'a\u2212b').length, 1);
    assert.deepStrictEqual(validateComposedText('a', 'a—b “yes”'), []);
    assert.deepStrictEqual(validateComposedText('`a\u200b`', '`a\u200b`'), []);
  });

  test('large worst-case and repeated inputs take bounded comparison fallback', () => {
    const start = Date.now();
    for (const repeated of [false, true]) {
      const original = Array.from({ length: 4000 }, (_, i) => `${repeated ? 'same' : i}\n`).join('');
      const rewritten = Array.from({ length: 4000 }, (_, i) => `${repeated ? 'different' : 4000 - i}\n`).join('');
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 1);
      assert.match(patch.groups[0].reason!, /Large/);
      assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, rewritten);
    }
    assert.ok(Date.now() - start < 2000, 'bounded fallback should finish well under two seconds');
  });

  test('seeded randomized repeated-line compositions preserve all/none and order', () => {
    let seed = 1729;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed; };
    const vocabulary = ['same\n', 'other\n', '😀\n', '\r\n', 'a\r\n', ''];
    for (let run = 0; run < 250; run++) {
      const original = Array.from({ length: random() % 15 }, () => vocabulary[random() % vocabulary.length]).join('');
      const rewritten = Array.from({ length: random() % 15 }, () => vocabulary[random() % vocabulary.length]).join('');
      const patch = createReviewPatch(original, rewritten);
      const ids = patch.groups.map(g => g.id);
      assert.strictEqual(composeReviewPatch(patch, ids).text, rewritten);
      assert.strictEqual(composeReviewPatch(patch, []).text, original);
      const subset = ids.filter(() => random() % 2);
      assert.strictEqual(composeReviewPatch(patch, subset).text, composeReviewPatch(patch, [...subset].reverse()).text);
    }
  });
});

function splitsSurrogate(text: string, offset: number): boolean {
  return offset > 0 && offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
}
