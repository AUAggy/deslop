import { stripInvisible, verifyProtectedRegions } from '../util/postCheck';
import { computeTextEdits, Span, TextEdit } from './match';
import { analyzeReviewStructure, Dependency, ReviewStructure } from './structure';

export interface ChangeGroup {
  readonly id: string;
  /** Offsets into the ORIGINAL snapshot, in UTF-16 code units. */
  readonly start: number;
  readonly end: number;
  readonly before: string;
  readonly after: string;
  readonly reason?: string;
}

export interface ReviewPatch {
  readonly original: string;
  readonly rewritten: string;
  readonly groups: readonly ChangeGroup[];
}

export interface AppliedSelectionSummary {
  readonly selectedGroupIds: readonly string[];
  readonly totalGroups: number;
  readonly selectedGroups: number;
  readonly fullRewrite: boolean;
}

export interface Composition {
  readonly text: string;
  readonly summary: AppliedSelectionSummary;
  readonly issues: readonly string[];
}

/**
 * Hierarchical matching isolates actual changes before grouping local sentence
 * and delimiter dependencies. Unchanged Markdown/protected content is an anchor,
 * not a reason to disable partial acceptance. No semantic independence is claimed.
 */
export function createReviewPatch(original: string, rewritten: string): ReviewPatch {
  let groups: ChangeGroup[] = [];
  if (original !== rewritten) {
    const oldStructure = analyzeReviewStructure(original);
    const newStructure = analyzeReviewStructure(rewritten);
    const edits = computeTextEdits(original, rewritten, oldStructure.protected, newStructure.protected);
    groups = groupEdits(edits, oldStructure, newStructure, original.length, rewritten.length).map((edit, i) => Object.freeze({
      id: `group-${i + 1}`, start: edit.start, end: edit.end,
      before: original.slice(edit.start, edit.end), after: rewritten.slice(edit.newStart, edit.newEnd),
      ...(edit.reason ? { reason: edit.reason } : {}),
    }));
  }
  return Object.freeze({ original, rewritten, groups: Object.freeze(groups) });
}

function groupEdits(edits: TextEdit[], original: ReviewStructure, rewritten: ReviewStructure, oldLength: number, newLength: number): TextEdit[] {
  // Each join records only affected edits. Overlapping join envelopes are merged;
  // this retains a single non-overlapping original-offset replacement per group.
  const joins: { first: number; last: number; reason?: string }[] = [];
  for (const [structure, proposal] of [[original, false], [rewritten, true]] as const) {
    for (const dependency of structure.joins) {
      const [first, last] = affectedEdits(edits, dependency.ranges, proposal);
      if (last >= 0) { joins.push({ first, last, reason: dependency.reason }); }
    }
  }
  // A moved opener and its unchanged closer belong to the SAME dependency in
  // both snapshots. Bridge via unchanged marker coordinates, otherwise selecting
  // only the opener's deletion/insertion could strand or duplicate a delimiter.
  for (const component of markerComponents(edits, original.joins, rewritten.joins, oldLength, newLength)) {
    let first = edits.length;
    let last = -1;
    const reasons = new Set<string>();
    for (const { dependency, proposal } of component) {
      const [from, to] = affectedEdits(edits, dependency.ranges, proposal);
      first = Math.min(first, from); last = Math.max(last, to);
      if (dependency.reason) { reasons.add(dependency.reason); }
    }
    if (last >= 0) { joins.push({ first, last, reason: [...reasons].join(' ') }); }
  }
  joins.sort((a, b) => a.first - b.first || a.last - b.last);
  const envelopes: { first: number; last: number; reasons: Set<string> }[] = [];
  for (const join of joins) {
    let envelope = envelopes.at(-1);
    if (!envelope || join.first > envelope.last) {
      envelope = { first: join.first, last: join.last, reasons: new Set() };
      envelopes.push(envelope);
    } else { envelope.last = Math.max(envelope.last, join.last); }
    if (join.reason) { envelope.reasons.add(join.reason); }
  }
  const grouped: TextEdit[] = [];
  let i = 0;
  let envelopeIndex = 0;
  while (i < edits.length) {
    const envelope = envelopes[envelopeIndex];
    const last = envelope?.first === i ? envelope.last : i;
    const reasons = new Set<string>(envelope?.first === i ? envelope.reasons : []);
    for (let k = i; k <= last; k++) { if (edits[k].reason) { reasons.add(edits[k].reason!); } }
    grouped.push({ start: edits[i].start, end: edits[last].end, newStart: edits[i].newStart, newEnd: edits[last].newEnd,
      ...(reasons.size ? { reason: [...reasons].join(' ') } : {}) });
    if (envelope?.first === i) { envelopeIndex++; }
    i = last + 1;
  }
  return grouped;
}

function affectedEdits(edits: TextEdit[], ranges: Span[], proposal: boolean): [number, number] {
  let first = edits.length;
  let last = -1;
  for (const range of ranges) {
    let lo = 0;
    let hi = edits.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const start = proposal ? edits[mid].newStart : edits[mid].start;
      const end = proposal ? edits[mid].newEnd : edits[mid].end;
      if (end < range.start || (end === range.start && start !== end)) { lo = mid + 1; } else { hi = mid; }
    }
    for (let i = lo; i < edits.length; i++) {
      const span = proposal ? { start: edits[i].newStart, end: edits[i].newEnd } : edits[i];
      if (span.start >= range.end) { break; }
      if (touches(span, range)) { first = Math.min(first, i); last = Math.max(last, i); }
    }
  }
  return [first, last];
}

function markerComponents(edits: TextEdit[], old: Dependency[], next: Dependency[], oldLength: number, newLength: number) {
  const nodes = [
    ...old.filter(dependency => dependency.markers).map(dependency => ({ dependency, proposal: false })),
    ...next.filter(dependency => dependency.markers).map(dependency => ({ dependency, proposal: true })),
  ];
  const parents = nodes.map((_, i) => i);
  const root = (i: number): number => {
    let ancestor = i;
    while (parents[ancestor] !== ancestor) { ancestor = parents[ancestor]; }
    while (parents[i] !== i) { const parent = parents[i]; parents[i] = ancestor; i = parent; }
    return ancestor;
  };
  const unchanged: TextEdit[] = [];
  let start = 0;
  let newStart = 0;
  for (const edit of [...edits, { start: oldLength, end: oldLength, newStart: newLength, newEnd: newLength }]) {
    if (start < edit.start) { unchanged.push({ start, end: edit.start, newStart, newEnd: edit.newStart }); }
    start = edit.end; newStart = edit.newEnd;
  }
  const keys = new Map<string, number>();
  nodes.forEach((node, index) => {
    for (const range of node.dependency.ranges) {
      let start = range.start;
      let end = range.end;
      if (node.proposal) {
        let lo = 0;
        let hi = unchanged.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (unchanged[mid].newEnd <= range.start) { lo = mid + 1; } else { hi = mid; } }
        const segment = unchanged[lo];
        if (!segment || segment.newStart > range.start || segment.newEnd < range.end) { continue; }
        start += segment.start - segment.newStart;
        end += segment.start - segment.newStart;
      }
      const key = `${start}:${end}`;
      const previous = keys.get(key);
      if (previous === undefined) { keys.set(key, index); }
      else { parents[root(index)] = root(previous); }
    }
  });
  const components = new Map<number, typeof nodes>();
  nodes.forEach((node, index) => {
    const id = root(index);
    const component = components.get(id) ?? [];
    component.push(node); components.set(id, component);
  });
  return components.values();
}

function touches(edit: Span, range: Span): boolean {
  return edit.start === edit.end ? range.start <= edit.start && edit.start < range.end
    : edit.start < range.end && edit.end > range.start;
}

/** Always reconstruct from original offsets; selection order cannot affect text. */
export function composeReviewPatch(patch: ReviewPatch, selectedIds: Iterable<string>): Composition {
  const selected = new Set(selectedIds);
  const known = new Set(patch.groups.map(g => g.id));
  for (const id of selected) {
    if (!known.has(id)) { throw new Error('Unknown review change group'); }
  }
  const pieces: string[] = [];
  let offset = 0;
  const ids: string[] = [];
  for (const group of patch.groups) {
    if (!selected.has(group.id)) { continue; }
    pieces.push(patch.original.slice(offset, group.start), group.after);
    offset = group.end;
    ids.push(group.id);
  }
  pieces.push(patch.original.slice(offset));
  const text = pieces.join('');
  // None means no edit, including no invisible-character cleanup of the source.
  const issues = ids.length === 0 ? [] : validateComposedText(patch.original, text);
  const cleanupIssue = issues.findIndex(issue => issue.includes('requires output-integrity cleanup'));
  if (cleanupIssue >= 0) {
    const related = patch.groups.filter(group => !selected.has(group.id) && stripInvisible(group.before).text !== group.before).map(group => group.id);
    if (related.length) { issues[cleanupIssue] += ` Excluded cleanup groups: ${related.join(', ')}. Include them explicitly or discard; no groups were added.`; }
  }
  return {
    text,
    summary: {
      selectedGroupIds: ids, totalGroups: patch.groups.length,
      selectedGroups: ids.length, fullRewrite: ids.length === patch.groups.length,
    },
    issues,
  };
}

/** Validation only: never silently clean up changes the user excluded. */
export function validateComposedText(original: string, text: string): string[] {
  const issues = verifyProtectedRegions(original, text);
  if (stripInvisible(text).text !== text) {
    issues.push('This selection requires output-integrity cleanup. Include the related cleanup group or choose the full rewrite; no excluded changes were added.');
  }
  return issues;
}
