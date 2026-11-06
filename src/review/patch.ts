import { collectProtectedRegions, stripInvisible, verifyProtectedRegions } from '../util/postCheck';

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

const MAX_CELLS = 250_000;

/**
 * Line-sized changes deliberately avoid offering word fragments as independent
 * edits. Markup and line-boundary changes use a single conservative group:
 * deterministic text diffing cannot establish structural or semantic independence.
 * The bounded LCS falls back to a whole rewrite rather than blocking the host.
 */
export function createReviewPatch(original: string, rewritten: string): ReviewPatch {
  const result = (groups: ChangeGroup[]): ReviewPatch => Object.freeze({
    original, rewritten, groups: Object.freeze(groups.map(g => Object.freeze(g))),
  });
  if (original === rewritten) { return result([]); }
  const whole = (reason: string): ReviewPatch => result([{
    id: 'group-1', start: 0, end: original.length, before: original, after: rewritten, reason,
  }]);
  if (hasDependentStructure(original) || hasDependentStructure(rewritten)) {
    return whole('Protected content or dependent markup is kept together; inspect the full group.');
  }
  const a = lines(original);
  const b = lines(rewritten);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return whole('Large comparison: changes are grouped to keep review responsive.');
  }
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j]
        ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const groups: ChangeGroup[] = [];
  let i = 0;
  let j = 0;
  let offset = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      offset += a[i++].length;
      j++;
      continue;
    }
    const start = offset;
    let before = '';
    let after = '';
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { break; }
      // A fixed tie-break makes repeated passages deterministic.
      if (j < b.length && (i === a.length || lengths[i * width + j + 1] > lengths[(i + 1) * width + j])) {
        after += b[j++];
      } else {
        before += a[i];
        offset += a[i++].length;
      }
    }
    groups.push({ id: `group-${groups.length + 1}`, start, end: offset, before, after });
  }
  // Changing line boundaries can make otherwise separate list/paragraph edits
  // dependent. Never offer arbitrary independent fragments of such a rewrite.
  if (groups.length > 1 && groups.some(g => newlineCount(g.before) !== newlineCount(g.after))) {
    return whole('Line-boundary changes are kept together to avoid dependent structural fragments.');
  }
  return result(groups);
}

function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function newlineCount(text: string): number {
  return text.split('\n').length - 1;
}

function hasDependentStructure(text: string): boolean {
  return collectProtectedRegions(text).length > 0 || /[`~]|^\s*(?:[-+*]\s|\d+[.)]\s|#{1,6}\s|>\s|---\s*$|\+\+\+\s*$|\|)/m.test(text);
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
