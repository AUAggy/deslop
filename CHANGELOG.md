# Changelog

## v0.1.5 -- unreleased

This one started as a security review and turned into a release-hardening pass.

**Workspace settings can no longer bypass review.** `autoAccept` and
`showChangeLog` now honor user-scope settings only, so a cloned repo
cannot silently skip the diff or hide the changelog through
`.vscode/settings.json`.

**Diff previews no longer write selected text to `/tmp`.** Review
buffers now use in-memory `untitled:` documents instead of predictable
temp files.

**Malformed model change logs are ignored safely.** Bad `changes`
entries from an LLM response are filtered before logging, so a rewrite
cannot succeed and then crash on changelog rendering.

**Comment selection handling is stricter and less surprising.**
Interior docstring selections are accepted, selections ending at column
0 no longer inspect the next unselected code line, and directive-style
`#` lines such as `#include` and `#if` are no longer treated as comments.

**Provider handling is less brittle.**
The default models now use DeepSeek V4 Flash on both providers:
`deepseek/deepseek-v4-flash` on OpenRouter and `deepseek-v4-flash` on
Venice. API-key validation now uses the configured model, and
provider-specific connection errors name the selected provider. Rewrite
requests now wait longer before timing out, which avoids failing slower
provider responses that still complete successfully.

*The release process found one more edge case than the scanner did. That is why the test count went up again.*

---

## v0.1.4 -- 2026-04-04

Docstrings and code comments now work properly. Three things changed.

**Python docstrings no longer get rejected.** If you selected the interior lines of a `"""` block -- the actual prose, not the delimiters -- DeSlop told you it only rewrites prose, not code. Technically true. Also wrong. Those lines are documentation. They pass now.

**The document type prompt disappears when it has an obvious answer.** Select a comment or docstring in a source file and DeSlop applies the Docstring/Comment rules directly -- no prompt. Works for `.py`, `.ts`, `.js`, `.ps1`, and any other source file. Prose in a `.md` file still shows the prompt. If you have `defaultDocumentType` set in settings, that wins.

**Code regions inside prose are protected.** Triple-backtick fences, inline `code` spans, and YAML frontmatter are reproduced verbatim. The LLM was usually leaving them alone anyway. Now it is told to.

The Docstring/Comment rules are tighter too. The old modifier said "be precise." The new one specifies what to cut (preambles, type restatements, passive constructions, AI documentation tells), what to keep (constraints, the why behind non-obvious behaviour, `@throws` conditions), and what voice to use. Structural markers -- JSDoc tags, Python section headers, PowerShell help keywords -- are preserved exactly. `@example` code blocks inside JSDoc are untouched.

*PowerShell `<# ... #>` block comments also work now. Nobody asked for this specifically. It seemed wrong to fix Python and not PowerShell.*

---

## v0.1.3 -- 2026-02-28

Fixed the before/after screenshot not displaying on the VS Code Marketplace and Open VSX. Relative image paths do not resolve on either marketplace. Switched to an absolute GitHub raw URL. The image was always there. Nobody could see it.

---

## v0.1.2 -- 2026-02-28

Two things broke. One visibly, one silently. Both fixed.

**Accepting a rewrite no longer fails silently.** If you were using DeSlop in a single-column layout, or VS Code decided to open the diff in a preview tab, accepting the diff did nothing. No error. No change. Just your original slop, untouched, while the extension quietly moved on with its life. The fix routes the edit through a document-level API that does not require the original editor tab to be open. It should have done this from the start.

**Error messages now tell you what the error is.** Previously, any API failure that was not a timeout or an invalid key produced "API returned an error. Try again in a moment." This is technically true and completely useless. It was masking 404s, 429s, model-not-found errors, and whatever else the provider felt like returning. The message now includes the actual error. A user discovered this immediately when switching from OpenRouter to Venice and forgetting to update the model ID. The provider helpfully suggested three alternatives in the error. DeSlop was previously hiding that suggestion behind a shrug.

**The README now has a before/after.** It is a block of maximally sloppy AI prose followed by what DeSlop does to it. The before text was written specifically for this purpose and is not representative of any real project. The after text was produced by DeSlop. The HN upvote count is accurate.

*If you find a bug, open an issue. If the rewrite is bad, that is the model's fault and also partially mine for picking it.*

---

## v0.1.1 -- 2026-02-28

I used this thing for 4 hours. Here is what I fixed because I got tired of my own complaints.

**It now remembers what you were doing.** Every time VS Code restarted, DeSlop forgot your document type and made you pick again. README. You always pick README. It knows now. It will remember across sessions like a tool that respects your time.

**You can update your API key without a support ticket to yourself.** Previously, if your key expired or you switched providers, there was no obvious way to swap it out. The answer was buried somewhere between "delete the keychain entry manually" and "just reinstall the extension." Now there is a command: *DeSlop: Reset API Key*. It is in the palette. You are welcome.

**There is a keyboard shortcut.** Shift+Alt+D. I cannot believe I shipped a tool meant to save you time and made you go through the command palette every single time. That is on me. You can rebind it if Shift+Alt+D conflicts with something. It probably does not.

**Discard now offers a second chance.** Before, clicking Discard just... ended things. No exit interview, no retry, just silence. Now it asks if you want to try again. You probably do. The model occasionally produces something slightly off and you just want another roll, not a full re-select-and-rerun ceremony.

**Error messages now contain information.** "Selection too long" now tells you how many words you selected and what the limit is. Groundbreaking concept. I am also slightly embarrassed it took a point release.

**The status bar and changelog got smarter.** The spinner now shows which document type and provider are running, so you know what you clicked and what is being charged to your API key. The changelog shows a timestamped header per run so when you have done four rewrites in a session you can actually tell which changes belong to which block.

*If you find a bug, open an issue. If the rewrite is bad, that is the model's fault and also partially mine for picking it.*

---

## v0.1.0 -- 2026-02-27

Initial release.
