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
