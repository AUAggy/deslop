# [BUG] Selections ending at the next line start inspect an unselected code line

**File:** [`src/util/isProseSelection.ts`](https://github.com/AUAggy/deslop/blob/main/src/util/isProseSelection.ts#L34-L81) (lines 34, 35, 64, 81)
**Project:** vscode-dslop
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-selection-boundary`

## Owners

**Suggested assignee:** `auaggy@auaggy.com` _(via last-committer)_

## Finding

The loop iterates through `selection.end.line` inclusively and ignores `selection.end.character`. In VS Code, a common way to select complete comment lines leaves the range ending at column 0 of the following line; `document.getText(selection)` does not include that next line, but this function still inspects it. If the following line is code, a valid prose selection is incorrectly rejected.

## Recommendation

Treat an end position at character 0 as exclusive for the following line, or inspect only the actual selected text/ranges rather than whole lines through `selection.end.line` unconditionally.

## Revalidation

**Verdict:** true-positive

The loop runs from `selection.start.line` through `selection.end.line` inclusively and never checks `selection.end.character`. In VS Code, a selection that covers complete comment lines often ends at character 0 of the following line, so the following line is not part of `document.getText(selection)`. `humanizeSelection` sends only the actual selected text to the model, but `isProseSelection` still inspects the next physical line because of the inclusive line loop. If that next line is executable code, the classifier returns false even though the code line was never selected. There is no compensating logic elsewhere in the function to make an end-at-column-zero range exclusive. The current unit-test helper does not model `character` positions at all, so the existing tests do not exercise this boundary behavior. A concrete example is selecting two `//` comment lines up to column 0 of a following `const x = 1;` line; the helper will reject that valid comment-only selection.

## Recent committers (`git log`)

- auaggy <auaggy@auaggy.com> (2026-04-04)
