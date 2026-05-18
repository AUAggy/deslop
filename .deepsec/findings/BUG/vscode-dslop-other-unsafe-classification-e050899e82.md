# [BUG] Language-agnostic prefix checks can classify executable code as prose

**File:** [`src/util/isProseSelection.ts`](https://github.com/AUAggy/deslop/blob/main/src/util/isProseSelection.ts#L114-L126) (lines 114, 115, 116, 117, 122, 123, 124, 125, 126)
**Project:** vscode-dslop
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-unsafe-classification`

## Owners

**Suggested assignee:** `auaggy@auaggy.com` _(via last-committer)_

## Finding

`isCommentOrStringLine` treats any trimmed line beginning with markers such as `#` as a comment regardless of the document language. In a C/C++ source file, lines like `#include` and `#define` are executable preprocessor directives, not comments, but they pass this guard. Because `humanizeSelection` relies on this helper to reject code selections before sending them to the model, the guard can allow non-prose code to be rewritten if the user selects such lines.

## Recommendation

Make comment detection language-aware using `document.languageId` and per-language comment syntax, or use VS Code tokenization APIs instead of a global prefix list.

## Revalidation

**Verdict:** true-positive

After excluding obvious prose files, `isProseSelection` decides source-file safety entirely with prefix heuristics and never consults `document.languageId` or a language-specific comment grammar. `isCommentOrStringLine` returns true for any trimmed line beginning with `#`, regardless of the file type. In a C or C++ document, executable preprocessor lines such as `#include <stdio.h>` and `#define SIZE 8` therefore pass the prose check even though they are not comments. `isCodeCommentSelection` simply delegates back to `isProseSelection`, so the same misclassification can also auto-select the `Docstring/Comment` document type in `humanizeSelection`. There is no later validation before the text is sent to the LLM and potentially rewritten. The existing tests only verify positive cases like Python comments and do not cover conflicting syntax across languages. A concrete failure case is a `.c` file containing a selected `#include` line: the guard accepts it as prose, so the extension can rewrite executable source despite the stated intent to reject code.

## Recent committers (`git log`)

- auaggy <auaggy@auaggy.com> (2026-04-04)
