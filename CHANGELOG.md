# Changelog

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
