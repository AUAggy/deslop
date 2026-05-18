# Vulnerability Scan Report

| Field | Value |
|-------|-------|
| Project | vscode-dslop |
| Date | 2026-05-16T13:45:56.862Z |
| Files tracked | 23 |
| Files analyzed | 23 |
| Total findings | 6 |

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| HIGH_BUG | 0 |
| BUG | 4 |

## MEDIUM (2)

### Workspace-controlled auto-accept bypasses the user review gate

- **File:** `src/commands/humanize.ts`
- **Recent committers:** auaggy <auaggy@auaggy.com>
- **Lines:** 66, 149, 152, 155, 178, 180, 183, 185
- **Slug:** other-silent-file-mutation
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** This is live in the current code. `humanizeSelection` reads the effective `deslop` configuration with `vscode.workspace.getConfiguration('deslop')`, and `package.json` declares `deslop.autoAccept` and `deslop.showChangeLog` without any code-level restriction that would ignore workspace-provided values. The effective `autoAccept` value is read at lines 149-155; when it is true, the function sets `accepted = true` and never calls `showDiffAndPrompt`. The returned `result.rewritten` text originates from the LLM response produced by `callHumanize`, so a malicious workspace can combine `.vscode/settings.json` values with prompt-influencing selected content and cause unseen model output to be applied at lines 178-180 after the user invokes the command. The document-version guard only prevents stale-selection writes and does not reintroduce user review or consent. The same workspace-controlled config object is then used for `showChangeLog`, so setting it false suppresses the post-write audit panel. Git history shows commit `7180127` introduced the auto-accept path, and no later commit in the current revision narrows it to user/global scope or inspects configuration provenance. A concrete attack is a malicious repo that sets `deslop.autoAccept: true` and `deslop.showChangeLog: false`; when the user runs DeSlop on a crafted prose selection, the file is rewritten without the expected review gate.

`humanizeSelection` reads `deslop` settings from `vscode.workspace.getConfiguration` at line 66, then honors the workspace-controlled `autoAccept` value at lines 149-155. A malicious workspace can place `"deslop.autoAccept": true` in `.vscode/settings.json`, causing the extension to skip `showDiffAndPrompt` entirely and treat the untrusted LLM response as accepted before writing it into the document with `WorkspaceEdit.replace` / `applyEdit` at lines 178-180. Because `showChangeLog` is also workspace-controlled at lines 183-185, the same workspace can suppress the post-write changelog, making the mutation effectively silent. The document-version check only prevents concurrent-edit races; it does not preserve user consent. This violates the stated threat model that an untrusted workspace must not be able to silently mutate the user's file without review.

**Recommendation:** Do not honor workspace-folder values for security-sensitive consent settings. Make `autoAccept` user/global-only, or use `config.inspect('autoAccept')` and ignore workspace/workspace-folder overrides; in untrusted workspaces, always require an explicit review/accept step before applying model output. Consider applying the same policy to audit-visibility settings such as `showChangeLog`.

---

### Predictable temp files expose selected text and permit temp-file races

- **File:** `src/ui/diff.ts`
- **Recent committers:** auaggy <auaggy@auaggy.com>
- **Lines:** 16, 17, 18, 19, 21, 22, 50, 51, 52
- **Slug:** other-insecure-temp-file
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** The current implementation writes both the original selection and the model rewrite to filesystem paths under `os.tmpdir()` using names derived only from `Date.now()` at lines 16-22. `fs.writeFileSync` is called with the default write mode and no exclusive flag or restrictive permission option, so the code neither randomizes the names nor rejects pre-existing paths. The `finally` block added in `fade71f` deletes the files only after `waitForStatusBarChoice()` resolves, which means the files remain on disk for the entire review window and potentially much longer if the user leaves the diff open. On a platform where `os.tmpdir()` is shared and ordinary file creation permissions are readable by other local users, another account can monitor for `deslop-original-*` and read the selected text while the review is pending. Because the timestamp is predictable, a local attacker can also pre-create likely future names, including symlinks on systems that permit that behavior, before the extension performs its non-exclusive writes. The cleanup is therefore only a partial mitigation for persistence, not for disclosure during use or path-race creation. This issue is platform-dependent, but the finding itself is accurate as stated because it explicitly scopes the exploit to shared-temp configurations.

`showDiffAndPrompt` writes both the user's selected text and the LLM rewrite to files under `os.tmpdir()` using names derived only from `Date.now()`, then leaves them on disk until the user accepts or discards the diff. On platforms where the temp directory is shared, these files are created with default permissions and predictable names, so another local user can monitor and read sensitive selections during the review window. Because the writes are not exclusive and the names are guessable, a local attacker can also pre-create matching paths or symlinks and race the extension into overwriting another victim-writable file.

**Recommendation:** Prefer an in-memory/virtual document diff so selected text never hits disk. If disk files are unavoidable, create a private randomized temp directory, use exclusive creation with restrictive permissions such as `0o600`, and avoid following attacker-controlled pre-existing paths.

---

## BUG (4)

### Malformed LLM change entries can crash the command after the edit is applied

- **File:** `src/ui/changelog.ts`
- **Recent committers:** auaggy <auaggy@auaggy.com>
- **Lines:** 21, 22
- **Slug:** other-unvalidated-response-data
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** The data flow confirms the report. `callHumanize` in `src/api/providers.ts` parses the model JSON and only verifies that `rewritten` is a string and `changes` is an array; it does not validate the shape of individual array elements before returning them. `humanizeSelection` applies `result.rewritten` to the document first, then calls `logChanges(result.changes, docType)` when `showChangeLog` is enabled, which is the default path. `logChanges` iterates each item and dereferences `c.pattern` and `c.action` directly at lines 21-22. If the model returns a syntactically valid response such as `{ "rewritten": "...", "changes": [null] }`, `changes` passes the array check but `c.pattern` throws a `TypeError`. `response_format: { type: 'json_object' }` does not provide a schema guarantee for those nested entries, and the prompt text is not a runtime validator. There is no surrounding catch around the post-edit changelog call, so the command can fail after the file mutation has already succeeded. The current code and history still contain this gap; no later commit adds defensive filtering or per-entry validation.

`logChanges` assumes every item in `changes` is a `ChangeEntry` object and dereferences `c.pattern` / `c.action` without runtime validation. The upstream parser in `src/api/providers.ts` only checks that `changes` is an array, not that each element has the expected shape, and `src/commands/humanize.ts` calls `logChanges(result.changes, docType)` after `applyEdit`. A malformed or prompt-influenced model response such as `"changes": [null]` would therefore throw in the default changelog path after the user's file has already been rewritten, leaving the command in a partially failed state.

**Recommendation:** Validate every `changes` entry before returning from `callHumanize`, or defensively filter/format only entries whose `pattern` and `action` fields are strings before logging them.

---

### Interior-only selections inside multiline comments are rejected

- **File:** `src/util/isProseSelection.ts`
- **Recent committers:** auaggy <auaggy@auaggy.com>
- **Lines:** 31, 32, 42, 44, 51, 57, 64
- **Slug:** other-logic-bug
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** The block-comment state machine is initialized with `insideBlock = null` at the start of every selection and only transitions into block mode when it sees an opener inside the selected range. If a Python docstring begins above the selection and the user selects only a plain interior line such as `Filters the list.`, the loop starts on that line with `insideBlock === null`. The line does not start with `"""`, `'''`, `<#`, or any recognized line-comment marker, so `isCommentOrStringLine` returns false and the function rejects it at lines 63-65. The function never scans preceding document lines to determine whether the selection begins inside an already-open block. The tests added in commit `c56bc67` cover selections that include the opener, but they do not cover the interior-only case described by the finding. That means the April change partially improved block handling without fixing this specific path. The report is therefore accurate: valid prose inside an existing multiline comment can still be misclassified as non-prose.

The block-comment state machine always starts with `insideBlock = null` and only enters block mode when the selected range itself contains an opening delimiter. If a user selects prose from the middle of an already-open Python docstring or PowerShell block comment, the plain interior lines are evaluated as ordinary source lines and rejected even though they are genuinely inside a prose block. This contradicts the function's stated behavior that source selections are prose when they lie inside a block-comment delimiter.

**Recommendation:** Determine whether the selection starts inside an existing block by scanning preceding lines or, preferably, use language-aware tokenization/comment metadata rather than inferring block state only from delimiters present inside the selection.

---

### Selections ending at the next line start inspect an unselected code line

- **File:** `src/util/isProseSelection.ts`
- **Recent committers:** auaggy <auaggy@auaggy.com>
- **Lines:** 34, 35, 64, 81
- **Slug:** other-selection-boundary
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** The loop runs from `selection.start.line` through `selection.end.line` inclusively and never checks `selection.end.character`. In VS Code, a selection that covers complete comment lines often ends at character 0 of the following line, so the following line is not part of `document.getText(selection)`. `humanizeSelection` sends only the actual selected text to the model, but `isProseSelection` still inspects the next physical line because of the inclusive line loop. If that next line is executable code, the classifier returns false even though the code line was never selected. There is no compensating logic elsewhere in the function to make an end-at-column-zero range exclusive. The current unit-test helper does not model `character` positions at all, so the existing tests do not exercise this boundary behavior. A concrete example is selecting two `//` comment lines up to column 0 of a following `const x = 1;` line; the helper will reject that valid comment-only selection.

The loop iterates through `selection.end.line` inclusively and ignores `selection.end.character`. In VS Code, a common way to select complete comment lines leaves the range ending at column 0 of the following line; `document.getText(selection)` does not include that next line, but this function still inspects it. If the following line is code, a valid prose selection is incorrectly rejected.

**Recommendation:** Treat an end position at character 0 as exclusive for the following line, or inspect only the actual selected text/ranges rather than whole lines through `selection.end.line` unconditionally.

---

### Language-agnostic prefix checks can classify executable code as prose

- **File:** `src/util/isProseSelection.ts`
- **Recent committers:** auaggy <auaggy@auaggy.com>
- **Lines:** 114, 115, 116, 117, 122, 123, 124, 125, 126
- **Slug:** other-unsafe-classification
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** After excluding obvious prose files, `isProseSelection` decides source-file safety entirely with prefix heuristics and never consults `document.languageId` or a language-specific comment grammar. `isCommentOrStringLine` returns true for any trimmed line beginning with `#`, regardless of the file type. In a C or C++ document, executable preprocessor lines such as `#include <stdio.h>` and `#define SIZE 8` therefore pass the prose check even though they are not comments. `isCodeCommentSelection` simply delegates back to `isProseSelection`, so the same misclassification can also auto-select the `Docstring/Comment` document type in `humanizeSelection`. There is no later validation before the text is sent to the LLM and potentially rewritten. The existing tests only verify positive cases like Python comments and do not cover conflicting syntax across languages. A concrete failure case is a `.c` file containing a selected `#include` line: the guard accepts it as prose, so the extension can rewrite executable source despite the stated intent to reject code.

`isCommentOrStringLine` treats any trimmed line beginning with markers such as `#` as a comment regardless of the document language. In a C/C++ source file, lines like `#include` and `#define` are executable preprocessor directives, not comments, but they pass this guard. Because `humanizeSelection` relies on this helper to reject code selections before sending them to the model, the guard can allow non-prose code to be rewritten if the user selects such lines.

**Recommendation:** Make comment detection language-aware using `document.languageId` and per-language comment syntax, or use VS Code tokenization APIs instead of a global prefix list.

---
