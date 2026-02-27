# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Pre-development. The only file currently in the repo is the product brief: `product-brief-vscode-humanizer.md`. That document is the single source of truth for all scope, architecture, and constraint decisions.

## What to Build

A VS Code extension ("Humanizer") that rewrites selected prose using the Anthropic API to remove AI-generated writing patterns. V1 is a single command: "Humanize Selection".

## Commands

Once scaffolded with `yo code` (TypeScript, no webpack, ESLint enabled):

```bash
npm run compile        # TypeScript compilation
npm run watch          # Watch mode for development
npm run lint           # ESLint
vsce package           # Package into .vsix for distribution
```

Press `F5` in VS Code to open an Extension Development Host for local testing.

## File Structure (exact — do not deviate)

```
src/
├── extension.ts          # Entry point, command registration
├── commands/
│   └── humanize.ts       # Core rewrite command logic
├── api/
│   └── openrouter.ts     # API call, prompt construction, response parsing
├── prompts/
│   ├── system.ts         # Base system prompt (the rules engine — core IP)
│   └── modifiers.ts      # Per-document-type prompt additions
├── storage/
│   └── secrets.ts        # vscode.SecretStorage wrapper for API key
├── ui/
│   ├── diff.ts           # VS Code native diff view handler
│   ├── statusBar.ts      # "Humanizing..." spinner
│   └── changelog.ts      # Output channel listing what changed
└── types.ts              # Shared TypeScript types
```

## Hard Constraints

- **API key**: stored exclusively in `vscode.SecretStorage`. Never in `settings.json`, `.env`, logs, or anywhere else.
- **System prompt content**: lives only in `src/prompts/system.ts`. No inline prompt strings elsewhere.
- **No external npm dependencies** beyond `vscode` (built-in) and `openai` (OpenRouter uses the OpenAI-compatible API). Use native Node `fetch` for HTTP.
- **V1 = one command only**: "Humanize Selection" (`humanizer.humanizeSelection`). No sidebar, no CodeLens, no file-level rewrite.
- **No backend in V1**: user provides their own Anthropic API key.
- **Do not build anything in Section 7 (V2) or Section 8 (Out of Scope)** of the product brief.

## Key Architecture Decisions

**Inference provider**: OpenRouter (`https://openrouter.ai/api/v1`), which is OpenAI-API-compatible. Use the `openai` npm package pointed at the OpenRouter base URL. Default model: `x-ai/grok-4.1-fast` (fast, cheap for MVP validation — swap to a stronger model via `humanizer.model` setting once traction is proven).

**Response format**: The API call must request JSON with two fields: `rewritten` (string) and `changes` (array of `{ pattern, action }` objects). The changes array feeds the changelog panel.

**Document types**: README, Docstring/Comment, Commit Message, Blog/Article. Each appends a modifier to the base system prompt. User's last selection persists as session default.

**Diff flow**: After inference, open VS Code's native diff view (`vscode.diff`) titled "Humanizer: Review Changes". Only replace editor text if user accepts. On discard, no changes.

**Code rejection (G5)**: If the selected text appears to be code (not inside a string literal, comment block, or markdown), reject with: "Humanizer rewrites prose, not code. Select a comment or documentation block."

**Token limit**: Reject selections over ~4,000 tokens (~3,000 words) with a clear error before making the API call.

**Model**: Default `x-ai/grok-4.1-fast`, configurable via `humanizer.model` setting. Any OpenRouter model ID is valid.

## VS Code Settings to Register (`humanizer.*`)

| Key | Type | Default |
|-----|------|---------|
| `humanizer.model` | string | `x-ai/grok-4.1-fast` |
| `humanizer.defaultDocumentType` | enum | `null` |
| `humanizer.showChangeLog` | boolean | `true` |
| `humanizer.autoAccept` | boolean | `false` |

## Bundle Constraint

Packaged `.vsix` must stay under 2MB. No large assets.
