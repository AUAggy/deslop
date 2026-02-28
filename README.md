<p align="center">
  <img src="images/icon.png" width="96" alt="DeSlop">
</p>

<h1 align="center">DeSlop</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=AUAggy.deslop"><img src="https://img.shields.io/visual-studio-marketplace/v/AUAggy.deslop?label=VS%20Code&color=0078d4" alt="VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/AUAggy/deslop"><img src="https://img.shields.io/open-vsx/v/AUAggy/deslop?label=Open%20VSX&color=c160ef" alt="Open VSX"></a>
  <a href="https://github.com/AUAggy/deslop/releases"><img src="https://img.shields.io/github/v/release/AUAggy/deslop?label=Release&color=e53e3e" alt="GitHub Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/AUAggy/deslop?color=555" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#getting-started">Install</a> &bull;
  <a href="#what-it-does">What it does</a> &bull;
  <a href="#what-it-removes">What it removes</a> &bull;
  <a href="#settings">Settings</a> &bull;
  <a href="#privacy">Privacy</a>
</p>

---

Your AI assistant writes documentation the way a nervous intern writes a performance review: inflated, hedged, and padded with words that sound important but carry no information. "Leverage synergies." "Foster innovation." "Seamlessly facilitate a paradigm shift."

DeSlop fixes that. Select the text, run the command, review the diff, accept or discard. The result reads like a person wrote it, specifically a person who knows what they are talking about and has no patience for filler.

<p align="center">
  <img src="https://raw.githubusercontent.com/AUAggy/deslop/main/images/deslop-before-after.png" alt="DeSlop before and after comparison" style="max-width: 100%;">
</p>

---

## What it does

DeSlop sends your selected prose to an AI model with a strict ruleset that bans the exact patterns AI models produce. It returns a rewrite and a structured list of every change made and why. You review the diff in VS Code's native diff view, then click Accept or Discard in the status bar at your own pace.

It does not generate new content. It does not check grammar. It rewrites what you already wrote, or what your AI assistant wrote for you, to meet a higher standard.

---

## Features

- **DeSlop Selection**: one command, available in the command palette and right-click context menu
- **Four document types**: README, Docstring/Comment, Commit Message, Blog/Article. Each applies a different set of style constraints.
- **Diff view**: side-by-side comparison before any text is changed
- **Status bar Accept/Discard**: persistent buttons so you can read the full diff before deciding
- **Changes panel**: structured list of every rule violated, shown in the Output panel after each accepted rewrite
- **Status bar indicator**: shows inference is running; disappears when done
- **Configurable model**: defaults to `x-ai/grok-4.1-fast` via OpenRouter; swap to any model you trust

---

## What it removes

**Banned vocabulary** -- words that appear in AI output at rates that would embarrass a thesaurus:

`delve` `leverage` `tapestry` `spearhead` `paradigm shift` `robust` `seamless` `synergy` `ecosystem` `holistic` `scalable` `utilize` `facilitate` `empower` `disruptive` `groundbreaking` `transformative` `innovative` `cutting-edge` `orchestrate` `curate` `cultivate` `democratize` `reimagine` `unleash` `harness` `supercharge` `north star` `mission-critical` `best-in-class` `thought leadership` `low-hanging fruit` `move the needle` `circle back` `double-click` `learnings` and 40 more

**Padding phrases** -- sentences that exist to delay the actual point:

`"it's worth noting"` `"essentially"` `"needless to say"` `"without further ado"` `"as you may know"` `"feel free to"` `"I'm excited to share"` `"as per"` and more

**Cliche structures** -- formats that signal AI authorship before the reader reads a word:

- `Question? Answer.` sentence pairs
- `"In a world where..."` openers
- `"This isn't X. It's Y."` contrasts
- `"Whether you're a X or a Y..."` appeals
- `"The future of X is here"`
- Anthropomorphism applied to code

**Decorative emojis** -- the ones that add energy but no information:

🚀 ✨ 🔥 ⚡ ✅ 🙌 💎 👉 🧠 ⭐ 🎉 🌍 📈 📣 🔒 🪄 🧵

**Smart typography** introduced silently by LLMs: curly quotes `"` `"`, em-dashes `--`, en-dashes `-`, and ellipses `...` replaced with their plain equivalents.

---

## Requirements

An API key from one of the supported providers:

**OpenRouter** (default): aggregates dozens of models under one key, including Grok, Claude, GPT, Llama, and more. No separate provider accounts required. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

**Venice**: privacy-focused inference. No data retention. Get a key at [venice.ai/settings/api](https://venice.ai/settings/api).

The extension asks for a key on first use and stores it in your OS keychain via VS Code SecretStorage. It is never written to any file. Each provider stores its key separately; switching providers prompts for a new key if none is saved for that provider.

---

## Getting started

**VS Code:** Search "DeSlop" in the Extensions panel, or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AUAggy.deslop).

**VSCodium:** Search "DeSlop" in the Extensions panel (pulls from Open VSX Registry), or install from [Open VSX](https://open-vsx.org/extension/AUAggy/deslop).

**Manual install:** Download the `.vsix` from the [latest GitHub release](https://github.com/AUAggy/deslop/releases), then run `Extensions: Install from VSIX` from the command palette.

Then:
1. Run **DeSlop Selection** from the command palette
2. Paste your API key when prompted
3. Select text, run the command, pick a document type, review the diff

---

## Commands

| Command | ID |
|---|---|
| DeSlop Selection | `deslop.humanizeSelection` |

Available in the command palette and the editor right-click context menu when text is selected.

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `deslop.provider` | enum | `openrouter` | `openrouter` or `venice` |
| `deslop.model` | string | `x-ai/grok-4.1-fast` | Model ID for the selected provider |
| `deslop.defaultDocumentType` | enum | `null` | Pre-select doc type; null means always prompt |
| `deslop.showChangeLog` | boolean | `true` | Show changes panel after each accepted rewrite |
| `deslop.autoAccept` | boolean | `false` | Skip diff view and apply immediately |

**Model IDs by provider:**
- OpenRouter: `x-ai/grok-4.1-fast`, `anthropic/claude-sonnet-4.6`, `openai/gpt-5.2`, and [hundreds more](https://openrouter.ai/models)
- Venice: `grok-41-fast`, `claude-sonnet-4-6`, `kimi-k2-5`, and [more](https://docs.venice.ai/models/overview)

---

## Privacy

Text submitted for rewriting goes to your chosen provider under your own API key. The extension does not store, log, or cache it. The provider's data retention policies apply.

The API key lives in your OS keychain. It does not appear in `settings.json`, logs, or anywhere a grep would find it.

---

## Limitations

- Rewrites prose only. Code selections are rejected.
- Maximum selection: approximately 3,000 words.
- One command. No file-level rewrites, no inline triggers, no sidebar.
- Requires an internet connection and an API key.

---

## License

MIT -- [Miaggy.com](https://miaggy.com)
