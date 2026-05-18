# vscode-dslop (DeSlop)

## What this codebase does

VS Code / VSCodium extension that rewrites a user-selected block of prose
by sending it to an LLM (OpenRouter or Venice, OpenAI-compatible APIs)
and replacing the selection with the returned rewrite after a diff
preview. TypeScript, compiled to CommonJS, runs in the VS Code extension
host (Node.js). No backend server, no telemetry, no bundled secrets.
Entry point is `src/extension.ts`; the one user-facing command is
`deslop.humanizeSelection`.

## Auth / secret shape

- **API keys** stored via `vscode.SecretStorage` (OS keychain) under
  `deslop.openrouterApiKey` / `deslop.veniceApiKey`. See
  `src/storage/secrets.ts` (`getApiKey`, `setApiKey`, `deleteApiKey`).
- Keys must never be written to `settings.json`, workspace state,
  globalState, logs, telemetry, or error messages.
- Network egress is exactly two hosts: `openrouter.ai/api/v1` and
  `api.venice.ai/api/v1` (constants in `src/api/providers.ts`).
- `validateApiKey` and `callHumanize` are the only call sites that
  receive the plaintext key.

## Threat model

A malicious or compromised workspace (untrusted folder, malicious
extension settings, crafted file contents) trying to (1) exfiltrate the
user's API key, (2) redirect requests to an attacker-controlled host,
(3) get the extension to execute attacker-controlled code on the host,
or (4) silently mutate the user's file without consent. Prompt-injection
content inside the selected text is in-scope for the *output* (the model
may return arbitrary text) but the extension must still treat that
output as untrusted data, never as code or shell input.

## Project-specific patterns to flag

- **Workspace-config-driven URLs / models reaching the network.** The
  `provider`, `model`, and any future URL-like setting come from
  `vscode.workspace.getConfiguration('deslop')`, which a malicious
  `.vscode/settings.json` controls. `baseURL` must stay pinned to the
  hardcoded `PROVIDER_CONFIG` map — flag any code that lets a setting
  flow into `baseURL`, `fetch`, `http.request`, or `child_process`.
- **API key leaking off the secret path.** Flag the key being logged,
  put in an error message, written to globalState/workspaceState,
  passed to `showInformationMessage`/`showErrorMessage`, sent to any
  host other than the two pinned providers, or returned from any
  exported function other than the `secrets.ts` getters.
- **Model JSON response trusted as code/markup.** `HumanizeResponse`
  comes from the LLM. It's inserted via `WorkspaceEdit.replace` (data,
  fine) — flag any path that instead `eval`s it, runs it through
  `executeCommand` with the string as an argument, renders it as HTML
  in a webview without escaping, or writes it to a shell.
- **Selection-replacement race conditions.** `humanizeSelection` already
  captures `document.version` and re-checks before `applyEdit`. Flag
  new write paths that skip that check, or that resolve a path/URI from
  document contents and write somewhere else.
- **`child_process` / `vm` / dynamic `require`.** This extension has no
  legitimate reason to spawn processes, eval, or dynamic-require. Flag
  any introduction.

## Known false-positives

- The two hardcoded `baseURL`s in `src/api/providers.ts` are intended
  outbound network endpoints, not SSRF.
- `HTTP-Referer: https://github.com/AUAggy/deslop` and `X-Title: DeSlop`
  default headers are intentional OpenRouter attribution, not info leak.
- `isProseSelection` calls an LLM with selected text — that's the core
  feature, not data exfiltration.
- `src/test/` fixtures may contain deliberately sloppy prose, fake keys,
  or sample LLM JSON; ignore "hardcoded secret" / "weak prose" hits there.
- `vscode.window.showInformationMessage`/`showErrorMessage` strings are
  shown to the local user only — not a log sink, not a network sink.
