type ProtectedKind = 'frontmatter' | 'code fence' | 'inline code';

interface ProtectedRegion {
  kind: ProtectedKind;
  text: string;
}

interface Range {
  start: number;
  end: number;
}

const FRONTMATTER_RE = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/;
const INLINE_CODE_RE = /`[^`\r\n]+`/g;

export function verifyProtectedRegions(
  original: string,
  rewritten: string
): string[] {
  const originalRegions = collectProtectedRegions(original);
  if (originalRegions.length === 0) {
    return [];
  }

  const issues: string[] = [];
  const regionCounts = new Map<string, { kind: ProtectedKind; count: number }>();

  for (const region of originalRegions) {
    const key = `${region.kind}\0${region.text}`;
    const existing = regionCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      regionCounts.set(key, { kind: region.kind, count: 1 });
    }
  }

  for (const [key, { kind, count }] of regionCounts.entries()) {
    const text = key.slice(key.indexOf('\0') + 1);
    const rewrittenCount = countOccurrences(rewritten, text);
    if (rewrittenCount < count) {
      issues.push(`${kind} changed or missing`);
    }
  }

  return issues;
}

export function collectProtectedRegions(text: string): ProtectedRegion[] {
  const regions: ProtectedRegion[] = [];
  const occupied: Range[] = [];

  const frontmatter = FRONTMATTER_RE.exec(text);
  if (frontmatter?.[0]) {
    regions.push({ kind: 'frontmatter', text: frontmatter[0] });
    occupied.push({ start: 0, end: frontmatter[0].length });
  }

  for (const range of findCodeFenceRanges(text)) {
    regions.push({ kind: 'code fence', text: text.slice(range.start, range.end) });
    occupied.push(range);
  }

  const inlineSearchText = maskRanges(text, occupied);
  let inlineMatch: RegExpExecArray | null;
  INLINE_CODE_RE.lastIndex = 0;
  while ((inlineMatch = INLINE_CODE_RE.exec(inlineSearchText)) !== null) {
    regions.push({ kind: 'inline code', text: text.slice(inlineMatch.index, inlineMatch.index + inlineMatch[0].length) });
  }

  return regions;
}

function findCodeFenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const lineRe = /^```.*(?:\r?\n|$)/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRe.exec(text)) !== null) {
    const start = match.index;
    const afterOpening = lineRe.lastIndex;
    lineRe.lastIndex = afterOpening;

    const closing = lineRe.exec(text);
    const end = closing ? lineRe.lastIndex : text.length;
    ranges.push({ start, end });

    lineRe.lastIndex = end;
  }

  return ranges;
}

function maskRanges(text: string, ranges: Range[]): string {
  if (ranges.length === 0) {
    return text;
  }

  const chars = text.split('');
  for (const range of ranges) {
    for (let i = range.start; i < range.end; i++) {
      chars[i] = ' ';
    }
  }
  return chars.join('');
}

// ---------------------------------------------------------------------------
// Output integrity guard (v0.1.7): invisible characters and confusable
// punctuation. Layer A only -- deterministic and verifiable. DeSlop makes no
// claims about statistical watermarks: every guarantee this project makes has
// a deterministic check behind it, or it is not made.
// ---------------------------------------------------------------------------

// Zero-width/joiners, bidi controls, soft hyphen: deleted outright.
const INVISIBLE_DELETE = new Set<number>([
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, // zero-width + joiners
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // bidi embedding/override
  0x2066, 0x2067, 0x2068, 0x2069, // bidi isolates
  0x00ad, // soft hyphen
]);

// Exotic spaces: replaced with a normal space, never deleted (deleting fuses words).
const SPACE_REPLACE = new Set<number>([
  0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a,
  0x202f, 0x205f, 0x3000,
]);

// Line/paragraph separators: replaced with a newline.
const NEWLINE_REPLACE = new Set<number>([0x2028, 0x2029]);

// Confusable punctuation -> ASCII. Deliberately closed list; curly quotes
// (U+2018/2019/201C/201D) and em/en dashes are legitimate typography and are
// never touched.
const CONFUSABLES = new Map<number, string>([
  [0x02bc, "'"], [0x02b9, "'"], [0x2032, "'"], [0x055a, "'"], [0xff07, "'"],
  [0x2033, '"'], [0xff02, '"'],
  [0x2010, '-'], [0x2011, '-'], [0x2043, '-'], [0x2212, '-'], [0xff0d, '-'],
]);

function isTagCharacter(cp: number): boolean {
  return cp >= 0xe0001 && cp <= 0xe007f;
}

// Protected ranges in a single text, for the strip pass. Mirrors
// collectProtectedRegions but returns positions instead of contents.
function collectProtectedRanges(text: string): Range[] {
  const ranges: Range[] = [];

  const frontmatter = FRONTMATTER_RE.exec(text);
  if (frontmatter?.[0]) {
    ranges.push({ start: 0, end: frontmatter[0].length });
  }

  ranges.push(...findCodeFenceRanges(text));

  const inlineSearchText = maskRanges(text, ranges);
  let inlineMatch: RegExpExecArray | null;
  INLINE_CODE_RE.lastIndex = 0;
  while ((inlineMatch = INLINE_CODE_RE.exec(inlineSearchText)) !== null) {
    ranges.push({ start: inlineMatch.index, end: inlineMatch.index + inlineMatch[0].length });
  }

  return ranges.sort((a, b) => a.start - b.start);
}

export function stripInvisible(rewritten: string): {
  text: string;
  invisibleCount: number;
  confusableCount: number;
} {
  const protectedRanges = collectProtectedRanges(rewritten);

  let out = '';
  let invisibleCount = 0;
  let confusableCount = 0;
  let index = 0; // UTF-16 code-unit index, matching Range offsets
  let rangeIdx = 0;

  // Codepoint-aware walk: tag characters live above the BMP, so a charCode
  // loop would split them into lone surrogates.
  for (const ch of rewritten) {
    while (rangeIdx < protectedRanges.length && index >= protectedRanges[rangeIdx].end) {
      rangeIdx += 1;
    }
    const inProtected =
      rangeIdx < protectedRanges.length &&
      index >= protectedRanges[rangeIdx].start &&
      index < protectedRanges[rangeIdx].end;
    index += ch.length;

    if (inProtected) {
      out += ch;
      continue;
    }

    const cp = ch.codePointAt(0)!;
    if (INVISIBLE_DELETE.has(cp) || isTagCharacter(cp)) {
      invisibleCount += 1;
      continue;
    }
    if (SPACE_REPLACE.has(cp)) {
      invisibleCount += 1;
      out += ' ';
      continue;
    }
    if (NEWLINE_REPLACE.has(cp)) {
      invisibleCount += 1;
      out += '\n';
      continue;
    }
    const ascii = CONFUSABLES.get(cp);
    if (ascii !== undefined) {
      confusableCount += 1;
      out += ascii;
      continue;
    }
    out += ch;
  }

  return { text: out, invisibleCount, confusableCount };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}
