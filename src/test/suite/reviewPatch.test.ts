import * as assert from 'assert';
import { composeReviewPatch, createReviewPatch, validateComposedText } from '../../review/patch';
import { analyzeReviewStructure } from '../../review/structure';

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

  test('unchanged protected frontmatter, fences and inline code are atomic anchors, not whole-document bans', () => {
    for (const protectedText of ['---\ntitle: Keep\n---\n', '```ts\nconst x = 1;\n```\n', '`value`']) {
      const original = `${protectedText}\nold\nanchor\nold end`;
      const rewritten = `${protectedText}\nnew\nanchor\nnew end`;
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 2);
      assert.ok(patch.groups.every(group => group.start >= protectedText.length));
      assert.deepStrictEqual(composeReviewPatch(patch, ['group-1']).issues, []);
      assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, `${protectedText}\nnew\nanchor\nold end`);
    }
  });

  test('local list/quote/table edits stay coupled without absorbing adjacent independent prose', () => {
    for (const block of ['- one\n- anchor\n- three', '1. one\n2. anchor\n3. three', '> one\n> anchor\n> three', '| one |\n| anchor |\n| three |']) {
      const original = `Old intro.\n\n${block}\n\nOld end.`;
      const rewritten = original.replace('Old intro', 'New intro').replace('one', 'ONE').replace('three', 'THREE').replace('Old end', 'New end');
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 3);
      assert.match(patch.groups[1].reason!, /Local/);
      assert.strictEqual(composeReviewPatch(patch, [patch.groups[1].id]).text, original.replace('one', 'ONE').replace('three', 'THREE'));
    }
    const patch = createReviewPatch('old\nanchor\ntail', 'new\nextra\nanchor\nTAIL');
    assert.ok(patch.groups.length >= 2);
    assert.strictEqual(composeReviewPatch(patch, [patch.groups.at(-1)!.id]).text, 'old\nanchor\nTAIL');
  });

  test('multiline link, emphasis, reference and HTML delimiter changes cannot form broken subsets', () => {
    const cases = [
      ['[Old label\nanchor\n](https://example.com)\n', 'New label\nanchor\n(plain note)\n'],
      ['*old\nanchor\nend*\n', 'new\nanchor\nend\n'],
      ['_old\nanchor\nend_\n', 'new\nanchor\nend\n'],
      ['[old][ref]\nanchor\n[ref]: https://example.com\n', 'new\nanchor\nplain note\n'],
      ['<strong>old\nanchor\nend</strong>\n', 'new\nanchor\nend\n'],
      ['"""old\nanchor\nend"""\n', 'new\nanchor\nend\n'],
      ["'''old\nanchor\nend'''\n", 'new\nanchor\nend\n'],
    ];
    for (const [original, rewritten] of cases) {
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 1);
      assert.strictEqual(composeReviewPatch(patch, []).text, original);
      assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, rewritten);
    }
  });

  test('README intro/conclusion remain selectable across unchanged heading, list, fences, links and inline code', () => {
    const middle = ['# Project', '- Keep this item.\n- And this item.', 'Use `run()` now.', '```ts\nconst x = 1;\n```', '[Guide](https://example.com)', '<aside>Keep this note.</aside>'];
    for (const unchanged of middle) {
      const original = `Old intro.\n\n${unchanged}\n\nOld conclusion.`;
      const rewritten = original.replace('Old intro', 'Clear intro').replace('Old conclusion', 'Clear conclusion');
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 2, unchanged);
      assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, original.replace('Old intro', 'Clear intro'));
      assert.strictEqual(composeReviewPatch(patch, ['group-2']).text, original.replace('Old conclusion', 'Clear conclusion'));
    }
  });

  test('separate edits in a single prose paragraph are practical sentence-sized choices', () => {
    const original = 'It is important to note that this is fast. In conclusion, it is reliable.';
    const rewritten = 'This is fast. It is reliable.';
    const patch = createReviewPatch(original, rewritten);
    assert.strictEqual(patch.groups.length, 2);
    assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, 'This is fast. In conclusion, it is reliable.');
    assert.strictEqual(composeReviewPatch(patch, ['group-2']).text, 'It is important to note that this is fast. It is reliable.');
  });

  test('EOF newline, line insertion and independent prose do not cause global fallback', () => {
    const original = 'Old first.\nanchor\nOld tail.';
    const rewritten = 'New first.\nanchor\nNew tail.\n';
    const patch = createReviewPatch(original, rewritten);
    assert.strictEqual(patch.groups.length, 3);
    const eof = patch.groups.at(-1)!;
    assert.strictEqual(eof.start, original.length);
    assert.strictEqual(eof.before, '');
    assert.strictEqual(eof.after, '\n');
    assert.strictEqual(composeReviewPatch(patch, [eof.id]).text, original + '\n');
    assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, original.replace('Old first', 'New first'));
  });

  test('500 mostly unchanged lines retain fine groups after bounded local matching', () => {
    const original = Array.from({ length: 500 }, (_, i) => `Line ${i}.\n`).join('');
    const rewritten = original.replace('Line 3.', 'Changed third line.').replace('Line 497.', 'Changed later line.');
    const patch = createReviewPatch(original, rewritten);
    assert.strictEqual(patch.groups.length, 2);
    assert.ok(patch.groups.every(group => !group.reason?.includes('Coarse')));
    assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, original.replace('Line 3.', 'Changed third line.'));
  });

  test('multiline delimiter and reference changes merge only their affected dependency envelope', () => {
    const cases = [
      ['[Old label\nanchor\n](https://example.com)\n', 'New label\nanchor\n(plain note)\n'],
      ['*old\nanchor\nend*\n', 'new\nanchor\nend\n'],
      ['_old\nanchor\nend_\n', 'new\nanchor\nend\n'],
      ['[old][ref]\n\nanchor\n\n[ref]: https://example.com\n', 'new\n\nanchor\n\nplain note\n'],
      ['<strong>old\nanchor\nend</strong>\n', 'new\nanchor\nend\n'],
      ['\"\"\"old\nanchor\nend\"\"\"\n', 'new\nanchor\nend\n'],
      ["'''old\nanchor\nend'''\n", 'new\nanchor\nend\n'],
    ];
    for (const [before, after] of cases) {
      const original = `Old intro.\n\n${before}\nOld conclusion.`;
      const rewritten = `New intro.\n\n${after}\nNew conclusion.`;
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 3, before);
      assert.match(patch.groups[1].reason!, /Coupled/);
      assert.strictEqual(composeReviewPatch(patch, ['group-2']).text, `Old intro.\n\n${after}\nOld conclusion.`);
    }
  });

  test('moving one delimiter while its partner stays unchanged cannot expose orphaned subset choices', () => {
    const cases = [
      ['(one\nanchor\ntwo)', 'one\n(anchor\ntwo)'],
      ['*one\nanchor\ntwo*', 'one\n*anchor\ntwo*'],
      ['[one\nanchor\ntwo](https://example.com)', 'one\n[anchor\ntwo](https://example.com)'],
      ['<em>one\nanchor\ntwo</em>', 'one\n<em>anchor\ntwo</em>'],
      ['\"\"\"one\nanchor\ntwo\"\"\"', 'one\n\"\"\"anchor\ntwo\"\"\"'],
    ];
    for (const [before, after] of cases) {
      const original = `Old intro.\n\n${before}\n\nOld end.`;
      const rewritten = `New intro.\n\n${after}\n\nNew end.`;
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 3, before);
      assert.strictEqual(composeReviewPatch(patch, ['group-2']).text, `Old intro.\n\n${after}\n\nOld end.`);
      assert.match(patch.groups[1].reason!, /Coupled/);
    }
  });

  test('unchanged paired HTML/triple quote delimiters do not couple independent body edits', () => {
    for (const [open, close] of [['<article>', '</article>'], ['\"\"\"', '\"\"\"']]) {
      const original = `${open}\nOld intro.\n\nUnchanged.\n\nOld conclusion.\n${close}`;
      const rewritten = original.replace('Old intro', 'New intro').replace('Old conclusion', 'New conclusion');
      const patch = createReviewPatch(original, rewritten);
      assert.strictEqual(patch.groups.length, 2);
      assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, original.replace('Old intro', 'New intro'));
    }
  });

  test('ambiguous syntax is labelled and kept local, with unrelated paragraph edits still selectable', () => {
    const original = 'Old intro.\n\nAn unmatched [old marker. Another old sentence.\n\nOld conclusion.';
    const rewritten = original.replaceAll('Old', 'New').replaceAll('old', 'new');
    const patch = createReviewPatch(original, rewritten);
    assert.strictEqual(patch.groups.length, 3);
    assert.match(patch.groups[1].reason!, /Coarse local block/);
    assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, original.replace('Old intro', 'New intro'));
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
    assert.match(partial.issues[0], /Excluded cleanup groups: group-1/);
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
      assert.ok(patch.groups.length >= 1);
      if (repeated) { assert.ok(patch.groups.some(group => group.reason?.includes('Coarse'))); }
      assert.strictEqual(composeReviewPatch(patch, patch.groups.map(group => group.id)).text, rewritten);
    }
    assert.ok(Date.now() - start < 2000, 'bounded fallback should finish well under two seconds');
  });

  test('expensive matching falls back only in the affected block and preserves surrounding choices', () => {
    const original = `Old intro.\n\nKEEP BEFORE\n${'x '.repeat(2000)}\nKEEP AFTER\n\nOld conclusion.`;
    const rewritten = original.replace('Old intro', 'New intro').replace('x '.repeat(2000), 'y '.repeat(2000)).replace('Old conclusion', 'New conclusion');
    const patch = createReviewPatch(original, rewritten);
    assert.strictEqual(patch.groups.length, 3);
    assert.ok(!patch.groups[0].reason?.includes('Coarse'));
    assert.match(patch.groups[1].reason!, /Coarse local comparison/);
    assert.ok(!patch.groups[2].reason?.includes('Coarse'));
    assert.strictEqual(composeReviewPatch(patch, ['group-1']).text, original.replace('Old intro', 'New intro'));
  });

  test('reference renames couple across paragraphs, but display text and URL body edits need not', () => {
    const original = 'Old intro.\n\n[Guide][old]\n\nUnchanged.\n\n[old]: https://example.com\n\nOld conclusion.';
    const renamed = original.replaceAll('[old]', '[new]').replace('Old intro', 'New intro').replace('Old conclusion', 'New conclusion');
    const patch = createReviewPatch(original, renamed);
    assert.strictEqual(patch.groups.length, 3);
    assert.match(patch.groups[1].reason!, /reference link/);
    assert.strictEqual(composeReviewPatch(patch, ['group-2']).text, original.replaceAll('[old]', '[new]'));
    const displayAndUrl = createReviewPatch(original, original.replace('Guide', 'Manual').replace('example.com', 'example.net'));
    assert.strictEqual(displayAndUrl.groups.length, 2);
  });

  test('seeded README subsets preserve exact atomic code spans and original/proposal boundaries', () => {
    let seed = 123;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed; };
    for (let run = 0; run < 100; run++) {
      const eol = run % 2 ? '\r\n' : '\n';
      const pieces = ['# Project', 'Old introduction. Another old sentence.', '- Keep item.\\n- Keep next.', 'Use `😀 value`. Old explanation.', '```ts\\nconst code = `keep`;\\n```', 'Old conclusion.'];
      const original = pieces.map(part => part.replaceAll('\\n', eol)).join(eol + eol);
      const rewritten = original.replace(/Old|old/g, word => random() % 2 ? (word === 'Old' ? 'New' : 'new') : word);
      const patch = createReviewPatch(original, rewritten);
      const originalProtected = analyzeReviewStructure(original).protected;
      const newProtected = analyzeReviewStructure(rewritten).protected;
      let delta = 0;
      let end = 0;
      for (const group of patch.groups) {
        assert.ok(group.start >= end);
        for (const range of originalProtected) {
          assert.ok(!(range.start < group.start && group.start < range.end));
          assert.ok(!(range.start < group.end && group.end < range.end));
        }
        for (const range of newProtected) {
          assert.ok(!(range.start < group.start + delta && group.start + delta < range.end));
          const newEnd = group.start + delta + group.after.length;
          assert.ok(!(range.start < newEnd && newEnd < range.end));
        }
        end = group.end;
        delta += group.after.length - group.before.length;
      }
      for (let mask = 0; mask < 2 ** patch.groups.length; mask++) {
        const ids = patch.groups.filter((_, i) => mask & (1 << i)).map(g => g.id);
        const composition = composeReviewPatch(patch, ids);
        assert.deepStrictEqual(composition.issues, []);
        assert.strictEqual(composition.text, composeReviewPatch(patch, ids.reverse()).text);
      }
      assert.strictEqual(composeReviewPatch(patch, patch.groups.map(g => g.id)).text, rewritten);
      assert.strictEqual(composeReviewPatch(patch, []).text, original);
    }
  });

  test('adversarial delimiter scans and unmatched syntax remain bounded', () => {
    const start = Date.now();
    for (const input of ['['.repeat(16000), '<!--'.repeat(4000), '<tag '.repeat(3200), '*x* '.repeat(4000)]) {
      const patch = createReviewPatch(input, input + ' changed');
      assert.strictEqual(composeReviewPatch(patch, patch.groups.map(g => g.id)).text, input + ' changed');
    }
    assert.ok(Date.now() - start < 2000);
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
