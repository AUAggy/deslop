import { collectProtectedRegions } from '../util/postCheck';
import type { Span } from './match';

export interface Dependency {
  ranges: Span[];
  reason?: string;
  markers?: boolean;
}
export interface ReviewStructure {
  protected: Span[];
  joins: Dependency[];
}

/**
 * A bounded conservative delimiter scanner, NOT a Markdown/Python/HTML parser.
 * Ordinary body edits do not join merely because a surrounding delimiter exists.
 * Only edits touching paired markers are coupled. Ambiguous/unmatched syntax is
 * kept together within its paragraph, never an automatic document-wide ban.
 */
export function analyzeReviewStructure(text: string): ReviewStructure {
  const protectedSpans = locateProtected(text);
  const joins: Dependency[] = [];
  // Comments are atomic too. A forward cursor avoids rescanning an unterminated
  // comment for every subsequent '<!--' in adversarial input.
  let commentCursor = 0;
  while (commentCursor < text.length) {
    const start = text.indexOf('<!--', commentCursor);
    if (start < 0) { break; }
    const close = text.indexOf('-->', start + 4);
    const end = close < 0 ? text.length : close + 3;
    if (!protectedSpans.some(span => span.start <= start && start < span.end)) {
      protectedSpans.push({ start, end });
      if (close < 0) { joins.push({ ranges: [{ start, end }], reason: 'Coarse local block: unterminated HTML comment.' }); }
    }
    commentCursor = end;
  }
  protectedSpans.splice(0, protectedSpans.length, ...mergeSpans(protectedSpans));

  const paragraphs: Span[] = [];
  let paragraphStart = 0;
  for (const match of text.matchAll(/(?:\r?\n)[ \t]*(?:\r?\n)/g)) {
    paragraphs.push({ start: paragraphStart, end: match.index! });
    paragraphStart = match.index! + match[0].length;
  }
  paragraphs.push({ start: paragraphStart, end: text.length });
  const ambiguous = (span: Span, syntax: string) => {
    // Unmatched markers can extend across physical lines, but not an unrelated
    // blank-line-separated paragraph. The reason is visible on the resulting group.
    const block = paragraphs.find(p => p.start <= span.start && span.start <= p.end) ?? span;
    joins.push({ ranges: [block], reason: `Coarse local block: ambiguous ${syntax}; review these changes together.` });
  };
  const dependency = (ranges: Span[], syntax: string) => joins.push({ ranges, markers: true, reason: `Coupled ${syntax} delimiter changes.` });
  const inProtected = (offset: number) => {
    let lo = 0;
    let hi = protectedSpans.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (protectedSpans[mid].end <= offset) { lo = mid + 1; } else { hi = mid; } }
    return lo < protectedSpans.length && protectedSpans[lo].start <= offset;
  };
  const escaped = (offset: number) => {
    let count = 0;
    while (offset > 0 && text[--offset] === '\\') { count++; }
    return count % 2 === 1;
  };

  // Sentence/physical-line groups are editorial granularity, NOT a claim of
  // semantic independence. Newline-only edits remain separate (including EOF).
  let sentenceStart = 0;
  for (const match of text.matchAll(/[.!?](?=\s|$)|\r?\n/g)) {
    const end = match.index! + (match[0].endsWith('\n') ? 0 : match[0].length);
    if (end > sentenceStart) { joins.push({ ranges: [{ start: sentenceStart, end }] }); }
    sentenceStart = match.index! + match[0].length;
  }
  if (sentenceStart < text.length) { joins.push({ ranges: [{ start: sentenceStart, end: text.length }] }); }

  // List/quote/table structures are local contiguous blocks. Preserve coupling
  // within the block, without absorbing adjacent paragraphs or prose lines.
  let block: Span | undefined;
  let blockKind = '';
  for (const match of text.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0];
    const kind = /^\s*(?:[-+*]\s|\d+[.)]\s)/.test(line) ? 'list'
      : /^\s*>/.test(line) ? 'blockquote' : /^\s*\|/.test(line) ? 'table' : '';
    if (block && (kind !== blockKind || inProtected(match.index!))) {
      joins.push({ ranges: [block], reason: `Local ${blockKind} block changes are kept together.` }); block = undefined;
    }
    if (kind && !inProtected(match.index!)) {
      if (!block) { block = { start: match.index!, end: match.index! + line.length }; blockKind = kind; }
      else { block.end = match.index! + line.length; }
    }
  }
  if (block) { joins.push({ ranges: [block], reason: `Local ${blockKind} block changes are kept together.` }); }

  const stacks = new Map<string, Span[]>();
  const brackets: Span[] = [];
  const parentheses: { marker: Span; bracket?: Span[] }[] = [];
  let lastBracket: Span[] | undefined;
  for (const match of text.matchAll(/"""|'''|\*+|_+|~+|\[|\]|\(|\)/g)) {
    const at = match.index!;
    const value = match[0];
    if (inProtected(at) || escaped(at)) { continue; }
    const marker = { start: at, end: at + value.length };
    if (value === '[') { brackets.push(marker); }
    else if (value === ']') {
      const open = brackets.pop();
      if (open) { lastBracket = [open, marker]; dependency(lastBracket, 'bracket'); }
      else { ambiguous(marker, 'bracket'); }
    } else if (value === '(') {
      parentheses.push({ marker, bracket: lastBracket?.[1].end === at ? lastBracket : undefined });
    } else if (value === ')') {
      const open = parentheses.pop();
      if (open) { dependency([...(open.bracket ?? []), open.marker, marker], open.bracket ? 'Markdown link' : 'parenthesis'); }
      else { ambiguous(marker, 'parenthesis'); }
    } else {
      // A list bullet is structural, not an unmatched emphasis opener.
      if (value === '*' && /^\s*$/.test(text.slice(text.lastIndexOf('\n', at - 1) + 1, at)) && /\s/.test(text[at + 1] ?? '')) { continue; }
      const stack = stacks.get(value) ?? [];
      const open = stack.pop();
      if (open) { dependency([open, marker], value === '"""' || value === "'''" ? 'triple quote' : 'emphasis'); }
      else { stack.push(marker); }
      stacks.set(value, stack);
    }
  }
  for (const marker of [...brackets, ...parentheses.map(p => p.marker), ...[...stacks.values()].flat()]) { ambiguous(marker, 'delimiter'); }

  const tags = new Map<string, Span[]>();
  for (const match of text.matchAll(/<\/?([a-z][\w:-]*)\b[^<>]*>/gi)) {
    if (inProtected(match.index!)) { continue; }
    const marker = { start: match.index!, end: match.index! + match[0].length };
    const name = match[1].toLowerCase();
    if (/\/\s*>$/.test(match[0]) || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name)) { continue; }
    const stack = tags.get(name) ?? [];
    if (match[0].startsWith('</')) {
      const open = stack.pop();
      if (open) { dependency([open, marker], 'HTML tag'); } else { ambiguous(marker, 'HTML tag'); }
    } else { stack.push(marker); }
    tags.set(name, stack);
  }
  for (const marker of [...tags.values()].flat()) { ambiguous(marker, 'HTML tag'); }

  // Explicit, collapsed and shortcut reference links couple identifier edits to
  // their definitions, even across paragraphs. URL/body edits need not rename IDs.
  const references = new Map<string, Span[]>();
  const addReference = (name: string, range: Span) => {
    const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
    references.set(key, [...(references.get(key) ?? []), range]);
  };
  const definitions = new Set<string>();
  for (const match of text.matchAll(/^[ \t]{0,3}\[([^\[\]\r\n]+)\]:/gm)) {
    if (inProtected(match.index!)) { continue; }
    const key = match[1].trim().replace(/\s+/g, ' ').toLowerCase();
    definitions.add(key);
    addReference(key, { start: match.index!, end: match.index! + match[0].length });
  }
  for (const match of text.matchAll(/\[([^\[\]\r\n]+)\](?:\[([^\[\]\r\n]*)\])?/g)) {
    if (inProtected(match.index!) || escaped(match.index!) || text[match.index! + match[0].length] === '(' || text[match.index! + match[0].length] === ':') { continue; }
    const name = match[2] || match[1];
    if (match[2] !== undefined || definitions.has(name.trim().replace(/\s+/g, ' ').toLowerCase())) {
      const start = match.index! + (match[2] ? match[0].lastIndexOf('[') + 1 : 1);
      addReference(name, { start, end: start + name.length });
    }
  }
  for (const ranges of references.values()) { if (ranges.length > 1) { dependency(ranges, 'reference link'); } }
  return { protected: protectedSpans, joins };
}

/** Locate the authoritative guard's exact regions, excluding nested occurrences. */
function locateProtected(text: string): Span[] {
  const spans: Span[] = [];
  let fenceCursor = 0;
  let inlineCursor = 0;
  for (const region of collectProtectedRegions(text)) {
    let at = region.kind === 'frontmatter' ? 0 : text.indexOf(region.text, region.kind === 'code fence' ? fenceCursor : inlineCursor);
    if (region.kind === 'inline code') {
      while (at >= 0 && spans.some(span => span.start <= at && at < span.end)) { at = text.indexOf(region.text, at + 1); }
    }
    if (at < 0) { continue; }
    spans.push({ start: at, end: at + region.text.length });
    if (region.kind === 'code fence') { fenceCursor = at + region.text.length; }
    if (region.kind === 'inline code') { inlineCursor = at + region.text.length; }
  }
  return mergeSpans(spans);
}

function mergeSpans(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = merged.at(-1);
    if (previous && span.start < previous.end) { previous.end = Math.max(previous.end, span.end); }
    else { merged.push({ ...span }); }
  }
  return merged;
}
