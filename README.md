# Humanizer — AI Slop Remover for VS Code

Your AI assistant writes documentation the way a nervous intern writes a performance review: inflated, hedged, and padded with words that sound important but mean nothing. "Leverage synergies." "Foster innovation." "Seamlessly facilitate a paradigm shift."

Humanizer fixes that. Select the text, run the command, review the diff, accept or discard. The result reads like a person wrote it — specifically, a person who knows what they are talking about and has no patience for filler.

---

## What it does

Humanizer sends your selected prose to an AI model with a strict ruleset that bans the exact patterns AI models love to produce. It returns a rewrite plus a structured list of every change made and why. You review the diff in VS Code's native diff view, then click Accept or Discard in the status bar at your own pace.

It does not generate new content. It does not check grammar. It rewrites what you already wrote — or what your AI assistant wrote for you — to meet a higher standard.

---

## Features

- **Humanize Selection** — one command, available in the command palette and right-click context menu
- **Four document types** — README, Docstring/Comment, Commit Message, Blog/Article — each applies a different set of style constraints
- **Diff view** — side-by-side comparison before any text is touched
- **Status bar Accept/Discard** — persistent buttons so you can read the full diff before deciding
- **Changelog panel** — structured list of every rule violated, shown in the Output panel after each accepted rewrite
- **Status bar spinner** — shows inference is running; goes away when it is done
- **Configurable model** — defaults to `x-ai/grok-4.1-fast` via OpenRouter; swap to any model you trust

---

## What it removes

**Banned vocabulary** — words that appear in AI output at rates that would embarrass a thesaurus:
`delve` `leverage` `tapestry` `spearhead` `paradigm shift` `robust` `seamless` `synergy` `ecosystem` `holistic` `scalable` `utilize` `facilitate` `empower` `disruptive` `groundbreaking` `transformative` `innovative` `cutting-edge` `orchestrate` `curate` `cultivate` `democratize` `reimagine` `unleash` `harness` `supercharge` `north star` `mission-critical` `best-in-class` `thought leadership` `low-hanging fruit` `move the needle` `circle back` `double-click` `learnings` + 40 more

**Padding phrases** — sentences that exist purely to delay the actual point:
`"it's worth noting"` `"essentially"` `"needless to say"` `"without further ado"` `"as you may know"` `"feel free to"` `"I'm excited to share"` `"as per"` + more

**Cliché structures** — formats that signal AI authorship before the reader reads a word:
- `Question? Answer.` sentence pairs
- `"In a world where..."` openers
- `"This isn't X. It's Y."` contrasts
- `"Whether you're a X or a Y..."` appeals
- `"The future of X is here"`
- Anthropomorphism applied to code

**Decorative emojis** — the ones that add energy but no information:
🚀 ✨ 🔥 ⚡ ✅ 🙌 💎 👉 🧠 ⭐ 🎉 🌍 📈 📣 🔒 🪄 🧵

**Smart typography** — curly quotes, em-dashes, en-dashes, and ellipses that LLMs insert silently: `"` `"` `'` `'` `—` `–` `…`

---

## Requirements

An [OpenRouter](https://openrouter.ai) API key. OpenRouter gives you access to dozens of models under one key — no separate Anthropic, OpenAI, or xAI account required. Keys are free to create; you pay per token at model cost.

Get a key at [openrouter.ai/keys](https://openrouter.ai/keys). The extension asks for it on first use and stores it in your OS keychain via VS Code's SecretStorage. It is never written to any file.

---

## Getting started

1. Install the extension
2. Run **Humanize Selection** from the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Paste your OpenRouter API key when prompted
4. Select text, run the command, pick a document type, review the diff

---

## Commands

| Command | ID | Where |
|---|---|---|
| Humanize Selection | `humanizer.humanizeSelection` | Command palette, right-click menu |

---

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `humanizer.model` | string | `x-ai/grok-4.1-fast` | Any OpenRouter model ID |
| `humanizer.defaultDocumentType` | enum | `null` | Pre-select doc type; null means always prompt |
| `humanizer.showChangeLog` | boolean | `true` | Show changelog panel after each accepted rewrite |
| `humanizer.autoAccept` | boolean | `false` | Skip diff view and apply immediately |

---

## Privacy

Text you submit for rewriting goes to OpenRouter under your own API key. The extension does not store, log, or cache it. OpenRouter's data retention policies apply — the same ones you agreed to when you created your key.

The API key lives in your OS keychain. It does not appear in settings.json, logs, or anywhere a curious grep would find it.

---

## Limitations (V1)

- Rewrites prose only. Code selections are rejected.
- Maximum selection: approximately 3,000 words.
- One command. No file-level rewrites, no inline triggers, no sidebar.
- Requires an internet connection and an OpenRouter API key.

---

## License

MIT — [Miaggy.com](https://miaggy.com)
