# Changelog

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
