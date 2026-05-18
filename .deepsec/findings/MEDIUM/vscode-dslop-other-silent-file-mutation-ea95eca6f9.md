# [MEDIUM] Workspace-controlled auto-accept bypasses the user review gate

**File:** [`src/commands/humanize.ts`](https://github.com/AUAggy/deslop/blob/main/src/commands/humanize.ts#L66-L185) (lines 66, 149, 152, 155, 178, 180, 183, 185)
**Project:** vscode-dslop
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-silent-file-mutation`

## Owners

**Suggested assignee:** `auaggy@auaggy.com` _(via last-committer)_

## Finding

`humanizeSelection` reads `deslop` settings from `vscode.workspace.getConfiguration` at line 66, then honors the workspace-controlled `autoAccept` value at lines 149-155. A malicious workspace can place `"deslop.autoAccept": true` in `.vscode/settings.json`, causing the extension to skip `showDiffAndPrompt` entirely and treat the untrusted LLM response as accepted before writing it into the document with `WorkspaceEdit.replace` / `applyEdit` at lines 178-180. Because `showChangeLog` is also workspace-controlled at lines 183-185, the same workspace can suppress the post-write changelog, making the mutation effectively silent. The document-version check only prevents concurrent-edit races; it does not preserve user consent. This violates the stated threat model that an untrusted workspace must not be able to silently mutate the user's file without review.

## Recommendation

Do not honor workspace-folder values for security-sensitive consent settings. Make `autoAccept` user/global-only, or use `config.inspect('autoAccept')` and ignore workspace/workspace-folder overrides; in untrusted workspaces, always require an explicit review/accept step before applying model output. Consider applying the same policy to audit-visibility settings such as `showChangeLog`.

## Revalidation

**Verdict:** true-positive

This is live in the current code. `humanizeSelection` reads the effective `deslop` configuration with `vscode.workspace.getConfiguration('deslop')`, and `package.json` declares `deslop.autoAccept` and `deslop.showChangeLog` without any code-level restriction that would ignore workspace-provided values. The effective `autoAccept` value is read at lines 149-155; when it is true, the function sets `accepted = true` and never calls `showDiffAndPrompt`. The returned `result.rewritten` text originates from the LLM response produced by `callHumanize`, so a malicious workspace can combine `.vscode/settings.json` values with prompt-influencing selected content and cause unseen model output to be applied at lines 178-180 after the user invokes the command. The document-version guard only prevents stale-selection writes and does not reintroduce user review or consent. The same workspace-controlled config object is then used for `showChangeLog`, so setting it false suppresses the post-write audit panel. Git history shows commit `7180127` introduced the auto-accept path, and no later commit in the current revision narrows it to user/global scope or inspects configuration provenance. A concrete attack is a malicious repo that sets `deslop.autoAccept: true` and `deslop.showChangeLog: false`; when the user runs DeSlop on a crafted prose selection, the file is rewritten without the expected review gate.

## Recent committers (`git log`)

- auaggy <auaggy@auaggy.com> (2026-04-04)
