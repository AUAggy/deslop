# [MEDIUM] Predictable temp files expose selected text and permit temp-file races

**File:** [`src/ui/diff.ts`](https://github.com/AUAggy/deslop/blob/main/src/ui/diff.ts#L16-L52) (lines 16, 17, 18, 19, 21, 22, 50, 51, 52)
**Project:** vscode-dslop
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-insecure-temp-file`

## Owners

**Suggested assignee:** `auaggy@auaggy.com` _(via last-committer)_

## Finding

`showDiffAndPrompt` writes both the user's selected text and the LLM rewrite to files under `os.tmpdir()` using names derived only from `Date.now()`, then leaves them on disk until the user accepts or discards the diff. On platforms where the temp directory is shared, these files are created with default permissions and predictable names, so another local user can monitor and read sensitive selections during the review window. Because the writes are not exclusive and the names are guessable, a local attacker can also pre-create matching paths or symlinks and race the extension into overwriting another victim-writable file.

## Recommendation

Prefer an in-memory/virtual document diff so selected text never hits disk. If disk files are unavoidable, create a private randomized temp directory, use exclusive creation with restrictive permissions such as `0o600`, and avoid following attacker-controlled pre-existing paths.

## Revalidation

**Verdict:** true-positive

The current implementation writes both the original selection and the model rewrite to filesystem paths under `os.tmpdir()` using names derived only from `Date.now()` at lines 16-22. `fs.writeFileSync` is called with the default write mode and no exclusive flag or restrictive permission option, so the code neither randomizes the names nor rejects pre-existing paths. The `finally` block added in `fade71f` deletes the files only after `waitForStatusBarChoice()` resolves, which means the files remain on disk for the entire review window and potentially much longer if the user leaves the diff open. On a platform where `os.tmpdir()` is shared and ordinary file creation permissions are readable by other local users, another account can monitor for `deslop-original-*` and read the selected text while the review is pending. Because the timestamp is predictable, a local attacker can also pre-create likely future names, including symlinks on systems that permit that behavior, before the extension performs its non-exclusive writes. The cleanup is therefore only a partial mitigation for persistence, not for disclosure during use or path-race creation. This issue is platform-dependent, but the finding itself is accurate as stated because it explicitly scopes the exploit to shared-temp configurations.

## Recent committers (`git log`)

- auaggy <auaggy@auaggy.com> (2026-02-28)
