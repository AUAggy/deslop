# [BUG] Malformed LLM change entries can crash the command after the edit is applied

**File:** [`src/ui/changelog.ts`](https://github.com/AUAggy/deslop/blob/main/src/ui/changelog.ts#L21-L22) (lines 21, 22)
**Project:** vscode-dslop
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-unvalidated-response-data`

## Owners

**Suggested assignee:** `auaggy@auaggy.com` _(via last-committer)_

## Finding

`logChanges` assumes every item in `changes` is a `ChangeEntry` object and dereferences `c.pattern` / `c.action` without runtime validation. The upstream parser in `src/api/providers.ts` only checks that `changes` is an array, not that each element has the expected shape, and `src/commands/humanize.ts` calls `logChanges(result.changes, docType)` after `applyEdit`. A malformed or prompt-influenced model response such as `"changes": [null]` would therefore throw in the default changelog path after the user's file has already been rewritten, leaving the command in a partially failed state.

## Recommendation

Validate every `changes` entry before returning from `callHumanize`, or defensively filter/format only entries whose `pattern` and `action` fields are strings before logging them.

## Revalidation

**Verdict:** true-positive

The data flow confirms the report. `callHumanize` in `src/api/providers.ts` parses the model JSON and only verifies that `rewritten` is a string and `changes` is an array; it does not validate the shape of individual array elements before returning them. `humanizeSelection` applies `result.rewritten` to the document first, then calls `logChanges(result.changes, docType)` when `showChangeLog` is enabled, which is the default path. `logChanges` iterates each item and dereferences `c.pattern` and `c.action` directly at lines 21-22. If the model returns a syntactically valid response such as `{ "rewritten": "...", "changes": [null] }`, `changes` passes the array check but `c.pattern` throws a `TypeError`. `response_format: { type: 'json_object' }` does not provide a schema guarantee for those nested entries, and the prompt text is not a runtime validator. There is no surrounding catch around the post-edit changelog call, so the command can fail after the file mutation has already succeeded. The current code and history still contain this gap; no later commit adds defensive filtering or per-entry validation.

## Recent committers (`git log`)

- auaggy <auaggy@auaggy.com> (2026-02-28)
