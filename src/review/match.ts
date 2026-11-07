/** Bounded, deterministic matching. No model explanations or mutable coordinates. */
export interface Span { start: number; end: number }
export interface TextEdit extends Span {
  newStart: number;
  newEnd: number;
  reason?: string;
}
interface Token extends Span { text: string }
interface Budget { cells: number }

export function computeTextEdits(original: string, rewritten: string, oldProtected: Span[], newProtected: Span[]): TextEdit[] {
  const budget = { cells: 250_000 };
  const coarse = compare(tokens(original, 0, original.length, oldProtected, true),
    tokens(rewritten, 0, rewritten.length, newProtected, true), 0, original.length, 0, rewritten.length, budget);
  return coarse.flatMap(edit => compare(
    tokens(original, edit.start, edit.end, oldProtected, false),
    tokens(rewritten, edit.newStart, edit.newEnd, newProtected, false),
    edit.start, edit.end, edit.newStart, edit.newEnd, budget,
  ));
}

/** CRLF, code points and protected regions are indivisible tokens at BOTH levels. */
function tokens(text: string, start: number, end: number, protectedSpans: Span[], lineLevel: boolean): Token[] {
  if (start === end) { return []; }
  const boundaries = new Set<number>([start, end]);
  const expression = lineLevel ? /[^\n]*\n|[^\n]+$/g : /\r\n|\n|[^\S\r\n]+|[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|./gu;
  const chunk = text.slice(start, end);
  for (const match of chunk.matchAll(expression)) {
    boundaries.add(start + match.index!);
    boundaries.add(start + match.index! + match[0].length);
  }
  const spans = protectedSpans.filter(span => span.start < end && span.end > start);
  for (const span of spans) { boundaries.add(span.start); boundaries.add(span.end); }
  let index = 0;
  const safe = [...boundaries].sort((a, b) => a - b).filter(offset => {
    while (index < spans.length && spans[index].end <= offset) { index++; }
    return offset >= start && offset <= end && !(index < spans.length && spans[index].start < offset && offset < spans[index].end);
  });
  return safe.slice(0, -1).map((offset, i) => ({ start: offset, end: safe[i + 1], text: text.slice(offset, safe[i + 1]) }));
}

function compare(a: Token[], b: Token[], start: number, end: number, newStart: number, newEnd: number, budget: Budget, depth = 0): TextEdit[] {
  // Equal context is never charged to the quadratic comparison budget.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix].text === b[prefix].text) { prefix++; }
  if (prefix) { start = a[prefix - 1].end; newStart = b[prefix - 1].end; a = a.slice(prefix); b = b.slice(prefix); }
  let suffix = 0;
  while (suffix < a.length && suffix < b.length && a[a.length - 1 - suffix].text === b[b.length - 1 - suffix].text) { suffix++; }
  if (suffix) { end = a[a.length - suffix].start; newEnd = b[b.length - suffix].start; a = a.slice(0, -suffix); b = b.slice(0, -suffix); }
  if (!a.length && !b.length) { return []; }
  if (!a.length || !b.length) { return [{ start, end, newStart, newEnd }]; }
  const cells = (a.length + 1) * (b.length + 1);
  if (cells > budget.cells || depth >= 32) {
    const anchors = depth < 32 ? uniqueAnchors(a, b) : [];
    if (!anchors.length) {
      return [{ start, end, newStart, newEnd, reason: 'Coarse local comparison block: bounded matching could not separate these changes.' }];
    }
    const edits: TextEdit[] = [];
    let ai = 0;
    let bi = 0;
    for (const [i, j] of anchors) {
      edits.push(...compare(a.slice(ai, i), b.slice(bi, j), start, a[i].start, newStart, b[j].start, budget, depth + 1));
      start = a[i].end; newStart = b[j].end; ai = i + 1; bi = j + 1;
    }
    edits.push(...compare(a.slice(ai), b.slice(bi), start, end, newStart, newEnd, budget, depth + 1));
    return edits;
  }
  budget.cells -= cells;
  const width = b.length + 1;
  const lengths = new Uint32Array(cells);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i].text === b[j].text ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const edits: TextEdit[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].text === b[j].text) { i++; j++; continue; }
    const from = i;
    const newFrom = j;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i].text === b[j].text) { break; }
      if (j < b.length && (i === a.length || lengths[i * width + j + 1] > lengths[(i + 1) * width + j])) { j++; }
      else { i++; }
    }
    edits.push({ start: from < a.length ? a[from].start : end, end: i ? a[i - 1].end : start,
      newStart: newFrom < b.length ? b[newFrom].start : newEnd, newEnd: j ? b[j - 1].end : newStart });
  }
  return edits;
}

/** Unique equal tokens form increasing (non-crossing) anchors in O(n log n). */
function uniqueAnchors(a: Token[], b: Token[]): [number, number][] {
  const positions = (tokens: Token[]) => {
    const map = new Map<string, number>();
    tokens.forEach((token, i) => map.set(token.text, map.has(token.text) ? -1 : i));
    return map;
  };
  const old = positions(a);
  const next = positions(b);
  const candidates: [number, number][] = [];
  for (const [text, i] of old) {
    const j = next.get(text);
    if (i >= 0 && j !== undefined && j >= 0) { candidates.push([i, j]); }
  }
  candidates.sort((x, y) => x[0] - y[0]);
  const tails: number[] = [];
  const previous = new Int32Array(candidates.length).fill(-1);
  candidates.forEach((candidate, index) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (candidates[tails[mid]][1] < candidate[1]) { lo = mid + 1; } else { hi = mid; } }
    if (lo) { previous[index] = tails[lo - 1]; }
    tails[lo] = index;
  });
  const anchors: [number, number][] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) { anchors.push(candidates[index]); }
  return anchors.reverse();
}
