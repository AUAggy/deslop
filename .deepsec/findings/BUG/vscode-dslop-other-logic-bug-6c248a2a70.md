# [BUG] Interior-only selections inside multiline comments are rejected

**File:** [`src/util/isProseSelection.ts`](https://github.com/AUAggy/deslop/blob/main/src/util/isProseSelection.ts#L31-L64) (lines 31, 32, 42, 44, 51, 57, 64)
**Project:** vscode-dslop
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `auaggy@auaggy.com` _(via last-committer)_

## Finding

The block-comment state machine always starts with `insideBlock = null` and only enters block mode when the selected range itself contains an opening delimiter. If a user selects prose from the middle of an already-open Python docstring or PowerShell block comment, the plain interior lines are evaluated as ordinary source lines and rejected even though they are genuinely inside a prose block. This contradicts the function's stated behavior that source selections are prose when they lie inside a block-comment delimiter.

## Recommendation

Determine whether the selection starts inside an existing block by scanning preceding lines or, preferably, use language-aware tokenization/comment metadata rather than inferring block state only from delimiters present inside the selection.

## Revalidation

**Verdict:** true-positive

The block-comment state machine is initialized with `insideBlock = null` at the start of every selection and only transitions into block mode when it sees an opener inside the selected range. If a Python docstring begins above the selection and the user selects only a plain interior line such as `Filters the list.`, the loop starts on that line with `insideBlock === null`. The line does not start with `"""`, `'''`, `<#`, or any recognized line-comment marker, so `isCommentOrStringLine` returns false and the function rejects it at lines 63-65. The function never scans preceding document lines to determine whether the selection begins inside an already-open block. The tests added in commit `c56bc67` cover selections that include the opener, but they do not cover the interior-only case described by the finding. That means the April change partially improved block handling without fixing this specific path. The report is therefore accurate: valid prose inside an existing multiline comment can still be misclassified as non-prose.

## Recent committers (`git log`)

- auaggy <auaggy@auaggy.com> (2026-04-04)
