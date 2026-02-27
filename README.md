# DeSlop

Your AI assistant writes documentation the way a nervous intern writes a performance review: inflated, hedged, and padded with words that sound important but carry no information. "Leverage synergies." "Foster innovation." "Seamlessly facilitate a paradigm shift."

DeSlop fixes that. Select the text, run the command, review the diff, accept or discard. The result reads like a person wrote it, specifically a person who knows what they are talking about and has no patience for filler.

---

## What it does

DeSlop sends your selected prose to an AI model with a strict ruleset that bans the exact patterns AI models produce. It returns a rewrite and a structured list of every change made and why. You review the diff in VS Code's native diff view, then click Accept or Discard in the status bar at your own pace.

It does not generate new content. It does not check grammar. It rewrites what you already wrote, or what your AI assistant wrote for you, to meet a higher standard.

---

## Features

- **DeSlop Selection** — one command, available in the command palette and right-click context menu
- **Four document types** — README, Docstring/Comment, Commit Message, Blog/Article — each applies a different set of style constraints
- **Diff view** — side-by-side comparison before any text is changed
- **Status bar Accept/Discard** — persistent buttons so you can read the full diff before deciding
- **Changes panel** — structured list of every rule violated, shown in the Output panel after each accepted rewrite
- **Status bar indicator** — shows inference is running; disappears when done
- **Configurable model** — defaults to `x-ai/grok-4.1-fast` via OpenRouter; swap to any model you trust

---

## What it removes

**Banned vocabulary** — words that appear in AI output at rates that would embarrass a thesaurus:

`delve` `leverage` `tapestry` `spearhead` `paradigm shift` `robust` `seamless` `synergy` `ecosystem` `holistic` `scalable` `utilize` `facilitate` `empower` `disruptive` `groundbreaking` `transformative` `innovative` `cutting-edge` `orchestrate` `curate` `cultivate` `democratize` `reimagine` `unleash` `harness` `supercharge` `north star` `mission-critical` `best-in-class` `thought leadership` `low-hanging fruit` `move the needle` `circle back` `double-click` `learnings` and 40 more

**Padding phrases** — sentences that exist to delay the actual point:

`"it's worth noting"` `"essentially"` `"needless to say"` `"without further ado"` `"as you may know"` `"feel free to"` `"I'm excited to share"` `"as per"` and more

**Cliche structures** — formats that signal AI authorship before the reader reads a word:

- `Question? Answer.` sentence pairs
- `"In a world where..."` openers
- `"This isn't X. It's Y."` contrasts
- `"Whether you're a X or a Y..."` appeals
- `"The future of X is here"`
- Anthropomorphism applied to code

**Decorative emojis** — the ones that add energy but no information:

🚀 ✨ 🔥 ⚡ ✅ 🙌 💎 👉 🧠 ⭐ 🎉 🌍 📈 📣 🔒 🪄 🧵

**Smart typography** introduced silently by LLMs: curly quotes `"` `"`, em-dashes `—`, en-dashes `–`, and ellipses `…` replaced with their plain equivalents.

---

## Requirements

An API key from one of the supported providers:

**OpenRouter** (default) — aggregates dozens of models under one key, including Grok, Claude, GPT, Llama, and more. No separate provider accounts required. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

**Venice** — privacy-focused inference with open-source models (Llama, Mistral, Qwen). No data retention. Get a key at [venice.ai/settings/api](https://venice.ai/settings/api).

The extension asks for a key on first use and stores it in your OS keychain via VS Code SecretStorage. It is never written to any file. Each provider stores its key separately — switching providers prompts for a new key if none is saved for that provider.

---

## Getting started

1. Install the extension
2. Run **DeSlop Selection** from the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Paste your OpenRouter API key when prompted
4. Select text, run the command, pick a document type, review the diff

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
- OpenRouter: `x-ai/grok-4.1-fast`, `anthropic/claude-sonnet-4-5`, `openai/gpt-4o`, and [hundreds more](https://openrouter.ai/models)
- Venice: `grok-41-fast`, `llama-3.3-70b`, `mistral-31-24b`, and [more](https://venice.ai/models)

---

## Privacy

Text submitted for rewriting goes to OpenRouter under your own API key. The extension does not store, log, or cache it. OpenRouter's data retention policies apply.

The API key lives in your OS keychain. It does not appear in `settings.json`, logs, or anywhere a grep would find it.

---

## Limitations

- Rewrites prose only. Code selections are rejected.
- Maximum selection: approximately 3,000 words.
- One command. No file-level rewrites, no inline triggers, no sidebar.
- Requires an internet connection and an OpenRouter API key.

---

## License

MIT — [Miaggy.com](https://miaggy.com)
