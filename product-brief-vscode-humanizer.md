You are building a VS Code extension from a product brief.
Read the full brief below, then execute the following:

1. Scaffold the extension using `yo code` (TypeScript, no webpack, 
   ESLint enabled)
2. Implement all V1 functional requirements in the order listed in 
   Section 9
3. Follow the file structure defined in Section 12 exactly
4. Do not build anything listed in Section 7 (V2) or Section 8 
   (Out of Scope)
5. After each file is written, verify it compiles before moving on
6. When complete, run `vsce package` and confirm the build is clean

Guardrails:
- API key must only ever touch vscode.SecretStorage (NFR-02)
- System prompt content lives in src/prompts/system.ts only
- No external npm dependencies beyond the vscode SDK and
  openai (OpenRouter is OpenAI-compatible)

--

# Product Brief: VS Code Anti-Slop Humanizer
**Version:** 1.0  
**Last Updated:** 2026-02-27  
**Status:** Pre-development  
**Owner:** TBD

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Target User](#2-target-user)
3. [Product Vision](#3-product-vision)
4. [Competitive Landscape](#4-competitive-landscape)
5. [Differentiation](#5-differentiation)
6. [V1 Scope: MVP](#6-v1-scope-mvp)
7. [V2 Scope: Post-Launch](#7-v2-scope-post-launch)
8. [Out of Scope (All Versions)](#8-out-of-scope-all-versions)
9. [Functional Requirements: V1](#9-functional-requirements-v1)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Writing Rules Engine](#11-writing-rules-engine)
12. [Technical Architecture: V1](#12-technical-architecture-v1)
13. [Technical Architecture: V2](#13-technical-architecture-v2)
14. [UX and Interaction Model](#14-ux-and-interaction-model)
15. [Security and Privacy](#15-security-and-privacy)
16. [Success Metrics](#16-success-metrics)
17. [Guardrails and Constraints](#17-guardrails-and-constraints)
18. [Effort Estimate](#18-effort-estimate)
19. [Deployment Plan](#19-deployment-plan)
20. [Open Questions](#20-open-questions)
21. [Revision History](#21-revision-history)

---

## 1. Problem Statement

Developers use AI coding assistants (GitHub Copilot, Cursor, ChatGPT) to draft not just code, but the written content that surrounds it: README files, inline comments, docstrings, commit messages, API documentation, changelogs, and technical blog posts. The output is functional but reads like AI generated it. Sentences are padded, phrasing is generic, structure is repetitive, and word choice is inflated. The developer knows this, ships it anyway because manual rewriting is slow, and the result is documentation that erodes trust in the project.

No tool in the VS Code ecosystem addresses this. Existing AI humanizer tools target students trying to evade plagiarism detectors. They are web-based, context-unaware, and optimized for the wrong outcome. They make text undetectable, not better.

This extension rewrites developer-authored content inside VS Code to meet a specific, opinionated standard of clear technical prose, applied directly to the file the developer is already working in.

---

## 2. Target User

**Primary:** Software developers and technical writers who draft documentation, README files, commit messages, or blog posts inside VS Code and use AI tools to generate first drafts.

**Secondary:** Developer advocates, open source maintainers, and developer relations writers who produce technical content at volume and need a quality pass before publishing.

**Not targeted (V1):** Students, content marketers, general bloggers, or anyone whose primary goal is bypassing AI detection tools.

### User Persona

A mid-level developer maintains two open source libraries. They use Copilot to draft READMEs and docstrings to save time. The output is technically accurate but reads stiffly. They manually rewrite it, which takes longer than writing from scratch. They want a one-command cleanup that enforces a consistent, human-sounding prose style without leaving VS Code.

---

## 3. Product Vision

A VS Code extension that rewrites selected text in any file to remove AI-generated writing patterns and produce clear, direct technical prose. The quality bar is: a senior engineer with strong writing instincts revised this, not a generic AI rewrite tool.

The extension applies a fixed, opinionated writing ruleset, not a configurable style guide. The rules are the product.

---

## 4. Competitive Landscape

| Tool | Format | Target User | Approach | VS Code |
|---|---|---|---|---|
| QuillBot Humanizer | Web + Chrome ext | Students, content writers | Detector evasion | No |
| NinjaHumanizer | Chrome ext | General | Detector evasion | No |
| Undetectable.ai | Web + Chrome ext | Students | Detector evasion | No |
| Rewritify | Web | Students | Detector evasion | No |
| Grammarly | Web + ext + Word | Professionals | Grammar, tone | No |
| GitHub Copilot | IDE | Developers | Code generation | Yes (generates, not fixes) |
| None | VS Code ext | Developers | Writing quality | — |

No tool in the VS Code Marketplace occupies this position.

---

## 5. Differentiation

**What this is not:** A detector-evasion tool. AI detection is irrelevant to the target user.

**What this is:** An opinionated prose editor for developers that applies a specific, documented set of writing rules to technical content.

The differentiation rests on three things:

1. **The ruleset.** The writing guide (see Section 11) is more specific and more defensible than anything competitors ship. It bans specific patterns by name, defines precise replacements, and applies different standards to different document types.

2. **The context.** Operating inside VS Code means the extension knows the file type, can replace text in place, and fits the developer's existing workflow without a context switch.

3. **The audience.** Developers who care about documentation quality are underserved. They have different needs, different vocabulary, and different trust signals than the mass consumer humanizer market.

---

## 6. V1 Scope: MVP

V1 delivers one command that does one thing well.

**Included:**

- Single command: "Humanize Selection" (replaces selected text in the active editor)
- Four document type contexts the user selects before rewriting: README, Docstring/Comment, Commit Message, Blog/Article
- API key setup via VS Code SecretStorage with a one-time onboarding prompt
- Diff view (VS Code native) showing original vs. rewritten text before the user accepts
- Status bar spinner during inference
- Changelog panel showing what was changed and why (per rewrite)
- Error handling with actionable messages (key not set, API error, selection too long)
- Support for plain text, Markdown (`.md`), and source code files (for comment/docstring selections)

**Not included in V1:** See Section 8.

---

## 7. V2 Scope: Post-Launch

V2 is defined as post-traction additions, not pre-launch commitments. Do not build any of these until V1 has real users and signal.

**Planned V2 features:**

- Backend proxy (Cloudflare Worker) so the extension can offer a free tier without requiring a user API key
- Usage tiers and monetization (free: N rewrites/day via proxy; paid: unlimited via subscription or own key)
- Channel/tone tuning beyond document type: Twitter/X, LinkedIn, Email as additional output contexts
- Inline CodeLens trigger above markdown headings and comment blocks ("Humanize this section")
- Sidebar panel for pasting arbitrary text without selecting in the editor
- Custom ruleset overrides (per workspace or per user): allow teams to extend the base ruleset
- Telemetry (opt-in): rewrite counts, document types used, accept/reject rates on diffs
- Support for `.mdx`, `.rst`, `.adoc` file types
- File-level rewrite command ("Humanize File") for bulk passes on documentation files
- VS Code Web support (vscode.dev, GitHub Codespaces)

**Potential V3+ (exploratory, not committed):**

- Companion web app sharing the same backend and ruleset
- GitHub Action for CI-level documentation quality checks
- JetBrains IDE port
- Slack / Notion integration via the same backend API

---

## 8. Out of Scope (All Versions)

These are hard exclusions, not deferred features:

- AI detection evasion as a stated goal or marketing claim
- Support for generating new content (this tool rewrites, it does not create)
- Grammar checking (Grammarly exists; do not rebuild it)
- Plagiarism checking
- Translation
- Mobile VS Code (not a real use case for this workflow)
- Code rewriting (the extension rewrites prose only; code selections are rejected with a clear message)

---

## 9. Functional Requirements: V1

### FR-01: API Key Onboarding

On first use, if no API key is stored, the extension prompts the user to enter an OpenRouter API key. The key is stored using `vscode.SecretStorage`. A link to obtain a key (https://openrouter.ai/keys) is included in the prompt. The key is validated with a lightweight test call before being saved. If validation fails, the user receives a specific error and the key is not stored.

### FR-02: Humanize Selection Command

The command "Humanize Selection" is available in the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and in the editor right-click context menu when text is selected. If no text is selected, the command prompts the user to select text first and exits.

### FR-03: Document Type Selection

Before each rewrite (or saved as a workspace/global default), the user selects one of four document types: README, Docstring/Comment, Commit Message, Blog/Article. The selection is presented as a VS Code Quick Pick dropdown. The selection modifies the system prompt context for the API call. The user's last selection persists as the default for subsequent calls in the same session.

### FR-04: Inference and Response

The extension calls the OpenRouter API (model: x-ai/grok-4.1-fast, configurable in settings) with the system prompt (see Section 11) plus the document type modifier and the selected text. The request uses `response_format: { type: "json_object" }` and the system prompt explicitly instructs the model to return only a JSON object with two fields: `rewritten` (string) and `changes` (array of objects, each with `pattern` and `action` string fields). Maximum input selection: 4,000 tokens. Selections exceeding this limit produce a clear error with the approximate word count limit.

### FR-05: Diff View

Before replacing text, the extension opens VS Code's native diff view showing the original selection on the left and the rewritten text on the right. The diff view is titled "Humanizer: Review Changes". Immediately after opening the diff, an information message notification appears with two buttons: "Accept" (replaces the selection in the editor) and "Discard" (no change). The native diff view is closed after either action.

### FR-06: Changelog Panel

After the user accepts a diff, the extension displays a VS Code Output Channel panel ("Humanizer: Changes") as a structured list of rule violations, one per line, e.g.: `Removed "leverage" (banned term)`, `Replaced "it's worth noting that" with direct statement`, `Removed padding phrase "essentially"`. Each entry maps to a `{ pattern, action }` object returned by the API. This panel persists across rewrites in the session and is cleared on extension reload.

### FR-07: Status Bar Indicator

During inference, a spinner and the text "Humanizing..." appear in the VS Code status bar. On completion or error, the status bar returns to its default state within 2 seconds.

### FR-08: Error Handling

All error states produce a VS Code notification with a human-readable message and, where applicable, a direct action button:

| Error | Message | Action Button |
|---|---|---|
| No API key | "Add your OpenRouter API key to use Humanizer." | "Add Key" |
| Invalid API key | "API key rejected. Check your key at openrouter.ai/keys." | "Update Key" |
| Selection too long | "Selection exceeds ~3,000 words. Select a shorter passage." | None |
| Code selected | "Humanizer rewrites prose, not code. Select a comment or documentation block." | None |
| API timeout | "Request timed out. Check your connection and try again." | "Retry" |
| API error (5xx) | "OpenRouter API returned an error. Try again in a moment." | "Retry" |

### FR-09: Settings

The following settings are exposed in VS Code settings (under `humanizer.*`):

| Key | Type | Default | Description |
|---|---|---|---|
| `humanizer.model` | string | `x-ai/grok-4.1-fast` | OpenRouter model to use |
| `humanizer.defaultDocumentType` | enum | `null` | Pre-select document type; null means always prompt |
| `humanizer.showChangeLog` | boolean | `true` | Show changelog panel after each rewrite |
| `humanizer.autoAccept` | boolean | `false` | Skip diff view and replace text immediately |

---

## 10. Non-Functional Requirements

**NFR-01: Latency.** Inference for a 200-word selection must complete within 15 seconds on a standard broadband connection. If the request exceeds 20 seconds, the extension cancels and surfaces the timeout error (FR-08).

**NFR-02: Security.** The API key is stored exclusively in `vscode.SecretStorage`. It is never written to `settings.json`, workspace files, `.env` files, or extension logs. The extension must not log the user's input text or API key at any verbosity level.

**NFR-03: Privacy.** No telemetry is collected in V1. No text submitted for rewriting is stored by the extension. Text is transmitted to the OpenRouter API under the user's own API key and subject to OpenRouter's data retention policies, which the user accepted when obtaining their key.

**NFR-04: Reliability.** The extension must not crash VS Code or destabilize the active editor on any error condition. All error paths return the editor to its pre-command state.

**NFR-05: Compatibility.** The extension must support VS Code 1.85.0 and later. It must function on macOS, Windows, and Linux. It does not require VS Code Web support in V1.

**NFR-06: Bundle size.** The packaged extension (`vsix`) must not exceed 2MB. No large bundled models or assets.

---

## 11. Writing Rules Engine

The system prompt encodes the following rules. This is the core IP of the product. The full ruleset is stored server-side (V2) or in the extension's non-inspectable Node.js process (V1, see Security note in Section 15).

### Banned Terms (replace or remove)

delve, leverage, paradigm shift, robust, seamless, cutting-edge, state-of-the-art, revolutionize, empower, disruptive, innovative, groundbreaking, game-changer, transformative, synergy, ecosystem, holistic, scalable, agile, dynamic, facilitate, utilize, implement (when "use" suffices), enhance, optimize, streamline, granular, pivotal, seminal, intricate, plethora, myriad, henceforth, aforementioned.

Also banned: marketing superlatives (best, fastest, easiest, most powerful) used without specific evidence.

### Banned Padding Phrases

"it's worth noting", "importantly", "it is important to note", "it should be noted that", "as a matter of fact", "in fact", "actually", "basically", "essentially", "simply put", "in other words", "to put it simply", "that is to say", "for all intents and purposes", "at the end of the day", "when it comes to", "in terms of", "with that said", "having said that", "be that as it may".

Excessive hedging: sequences of "should", "might", "could", "probably", "possibly", "perhaps", "maybe", "likely", "potentially", "arguably".

### Banned Cliché Formats

- "Question? Answer." sentence structure
- "This isn't X. It's Y."
- "In a world where..." / "Imagine a world..."
- "Let's face it:" / "Here's the thing:" / "The truth is:"
- "At its core:" / "Say goodbye to X and hello to Y."
- Anthropomorphism applied to code or tools ("the library wants to...", "the function loves...")
- Em-dashes used as clause connectors or inline asides (replace with colon, semicolon, comma, or rewrite)

### Style Rules Applied

- Active voice and imperative mood for instructions
- Remove redundant phrases: "in order to" becomes "to"; "due to the fact that" becomes "because"
- Replace vague terms with specific language
- Vary sentence length: mix short declarative sentences with longer explanatory ones
- Define technical terms on first use
- Present tense for stable features, future tense for planned ones, past tense for history
- No first-person (I/we) or second-person (you) outside direct instructions
- No exclamation points

### Document Type Modifiers

Each document type appends a short additional instruction block to the base system prompt:

**README:** Technical and direct. Assume the reader is a developer evaluating whether to use the project. Lead with what the project does, not what it is. No mission statements.

**Docstring/Comment:** Precision over completeness. Describe what the function does, its parameters, and return values. Remove any commentary that restates what the code already shows.

**Commit Message:** 50-character subject line, imperative mood, no period. Body (if any) explains why, not what. Maximum 72 characters per body line.

**Blog/Article:** Allow slightly more personality than other types. Short paragraphs. Personal observations are acceptable. Avoid the structure of a listicle unless the content genuinely is a list.

---

## 12. Technical Architecture: V1

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Extension runtime | TypeScript + Node.js | VS Code's native extension language; full Node access |
| Build tooling | Vite + CRXJS or esbuild | Fast builds, small output bundle |
| VS Code API | `vscode` SDK (built-in) | SecretStorage, diff view, output channels, Quick Pick |
| LLM | OpenRouter API (x-ai/grok-4.1-fast) | Speed, low cost for MVP validation; swap model without code changes |
| HTTP client | Node `fetch` (native, Node 18+) | No external dependency needed; OpenRouter is OpenAI-compatible |
| Extension packaging | `vsce` CLI | Official VS Code extension packager |

### Data Flow

```
User selects text in editor
        |
Command: "Humanize Selection"
        |
Quick Pick: document type
        |
Retrieve API key from SecretStorage
        |
Build request:
  - system prompt (rules engine, Section 11)
  - document type modifier
  - user text wrapped in <source_text> tags
        |
POST https://openrouter.ai/api/v1/chat/completions
  model: x-ai/grok-4.1-fast
  response_format: JSON { rewritten, changes[] }
        |
Open VS Code diff view (original | rewritten)
        |
User accepts or discards
        |
If accepted: replace selection in editor
If accepted: write changes[] to Output Channel
```

### File Structure

```
/
├── src/
│   ├── extension.ts          # Entry point, command registration
│   ├── commands/
│   │   └── humanize.ts       # Core rewrite command
│   ├── api/
│   │   └── openrouter.ts     # API call, prompt construction, response parsing
│   ├── prompts/
│   │   ├── system.ts         # Base system prompt (rules engine)
│   │   └── modifiers.ts      # Per-document-type modifiers
│   ├── storage/
│   │   └── secrets.ts        # SecretStorage wrapper
│   ├── ui/
│   │   ├── diff.ts           # Diff view handler
│   │   ├── statusBar.ts      # Spinner and status indicator
│   │   └── changelog.ts      # Output channel for change log
│   └── types.ts              # Shared TypeScript types
├── package.json              # Extension manifest (contributes, activationEvents)
├── tsconfig.json
├── vite.config.ts
└── README.md
```

### Key VS Code APIs Used

- `vscode.SecretStorage`: API key storage
- `vscode.window.showQuickPick`: Document type selection
- `vscode.window.showTextDocument` + `vscode.diff`: Diff view
- `vscode.window.createOutputChannel`: Changelog panel
- `vscode.window.setStatusBarMessage`: Spinner
- `vscode.window.showErrorMessage` / `showInformationMessage`: Notifications
- `vscode.workspace.getConfiguration`: User settings

---

## 13. Technical Architecture: V2

V2 introduces a backend proxy to remove the API key requirement for end users, enabling a free tier and a monetization model.

### Backend Stack (Cloudflare-native)

| Layer | Choice | Rationale |
|---|---|---|
| Proxy / API | Cloudflare Worker | Zero cold starts, edge deployment, matches existing preference |
| Rate limiting | Cloudflare KV + built-in rate limiting | Serverless-friendly, no Redis needed |
| User accounts | Cloudflare D1 (SQLite at edge) | Same ecosystem, avoids AWS context switch for simple queries |
| Auth tokens | JWT issued on signup, verified in Worker | Stateless, no session store |
| Billing | Stripe | Standard, well-documented, Cloudflare Worker compatible |
| Landing page | Cloudflare Pages | Same ecosystem, free tier |

### V2 Data Flow

```
Extension (no user API key required)
        |
POST https://api.yourdomain.com/rewrite
  Authorization: Bearer <user_token>
  Body: { text, documentType, channel }
        |
Cloudflare Worker:
  1. Verify JWT
  2. Check rate limit (KV)
  3. Check usage tier (D1)
  4. Build prompt (system prompt lives here, not in extension)
  5. Call OpenRouter API with owner API key
  6. Return { rewritten, changes[] }
        |
Extension renders diff view (same as V1)
```

### V2 Tier Model (indicative)

| Tier | Rewrites/day | Price | Key source |
|---|---|---|---|
| Free | 5 | $0 | Owner key via proxy |
| Pro | Unlimited | $8/mo | Owner key via proxy |
| BYOK | Unlimited | $0 | User's own key, bypasses proxy |

---

## 14. UX and Interaction Model

### Primary Flow (V1)

1. Developer writes or pastes AI-generated prose into a `.md` or source file in VS Code.
2. Developer selects the passage with the cursor.
3. Developer opens command palette and runs "Humanize Selection" (or right-clicks and selects it from the context menu).
4. A Quick Pick dropdown appears: "Select document type: README / Docstring / Commit Message / Blog". Developer selects one. If `humanizer.defaultDocumentType` is set, this step is skipped.
5. Status bar shows "Humanizing..." with a spinner.
6. Diff view opens. Left pane: original text. Right pane: rewritten text.
7. Developer reviews the diff. Two buttons: "Accept" and "Discard".
8. On Accept: editor replaces the selection in place. Changelog panel opens listing specific changes.
9. On Discard: editor returns to its pre-command state. No changes.

### Keyboard Shortcut (V1)

Default: none assigned. Users assign their own via VS Code keybinding settings. The command ID is `humanizer.humanizeSelection`.

### Onboarding Flow (first use only)

1. User runs "Humanize Selection" for the first time.
2. Notification: "Humanizer needs an OpenRouter API key. Enter it now or get one at openrouter.ai/keys." Two buttons: "Enter Key" and "Get Key".
3. "Enter Key" opens a secure input box (password field, no echo). User pastes key.
4. Extension validates the key with a test call.
5. On success: "Key saved. Ready to humanize." Key stored in SecretStorage.
6. On failure: "Key not valid. Check and try again." Input box re-opens.

---

## 15. Security and Privacy

### API Key Protection

The API key is stored in `vscode.SecretStorage`, which maps to the OS keychain on macOS and Windows Credential Manager on Windows. It is not stored in `settings.json`, workspace files, or any file accessible to other extensions.

The key is never logged, never transmitted to any server other than `openrouter.ai`, and never included in error reports or telemetry.

### System Prompt Confidentiality

In V1, the system prompt runs in the extension's Node.js process on the user's machine. It is compiled into the extension bundle and, while not trivially readable, is technically extractable by a motivated developer who unpacks the `.vsix` file. This is acceptable for V1 given that the extension is a developer tool.

In V2, the system prompt moves to the Cloudflare Worker. It is never transmitted to the client. This is the primary security improvement V2 delivers, in addition to removing the API key requirement.

### Data Handling

User text submitted for rewriting is sent to OpenRouter's API under the user's own API key in V1. OpenRouter's data retention policies apply. The extension does not store, log, or cache submitted text.

---

## 16. Success Metrics

### V1 Launch (first 30 days)

| Metric | Target |
|---|---|
| VS Code Marketplace installs | 200 |
| Active users (at least 1 rewrite) | 80 |
| Diff accept rate | >60% |
| 5-star reviews | 10+ |
| Critical bug reports | 0 |

### V1 Sustained (30-90 days)

| Metric | Target |
|---|---|
| Weekly active users | 50+ |
| Average rewrites per active user per week | 3+ |
| Organic mentions (GitHub, Reddit, HN, newsletters) | 5+ |

### V2 Trigger Criteria

V2 backend development starts when any two of the following are true:

- 500 total installs
- 10+ users mention friction around API key requirement in issues or reviews
- A single user reaches out about team/enterprise use
- Weekly active users plateau and qualitative feedback cites onboarding friction

---

## 17. Guardrails and Constraints

These constraints apply to all development decisions in V1. Violating them requires an explicit revision to this document, not an ad-hoc exception.

**G1: One command in V1.** "Humanize Selection" is the only command shipped. No sidebar, no file-level rewrite, no inline CodeLens. These are V2.

**G2: No backend in V1.** User provides their own API key. Zero infrastructure to operate or pay for.

**G3: Prompt quality before UI.** The extension is not released until the rewrite output passes a manual review of 20 test cases covering all four document types. Output quality is the product. UI is the delivery mechanism.

**G4: No detector-evasion language.** The Marketplace listing, README, and any marketing copy must not contain the words "undetectable", "bypass", "AI detector", or similar. The product is a writing quality tool. Framing it as a detector-evasion tool attracts the wrong users and invites association with academic dishonesty.

**G5: No code rewriting.** If the user selects code (non-prose), the extension rejects the selection with a clear message. Detection heuristic: selections in `.md` and `.txt` files are always treated as prose. In source code files (`.ts`, `.py`, `.go`, `.js`, etc.), the selection is allowed only if it falls entirely within a comment block (line comment or block comment) or a string literal, determined by checking VS Code's token type at the selection boundaries. Any selection that spans code tokens is rejected.

**G6: Changelog on every accept.** The changelog panel is never suppressed on an accepted rewrite unless the user explicitly sets `humanizer.showChangeLog: false`. Transparency about what changed is a trust signal.

---

## 18. Effort Estimate

| Task | Estimated Hours |
|---|---|
| Product brief finalization | 1-2 |
| Prompt engineering and test case validation (20 cases) | 3-4 |
| Extension scaffold (Yeoman generator + package.json) | 0.5 |
| SecretStorage + onboarding flow | 1 |
| Core rewrite command + API call | 2-3 |
| Diff view integration | 1 |
| Changelog output channel | 1 |
| Status bar spinner + error handling | 1 |
| Settings registration | 0.5 |
| README + Marketplace listing (description, tags, screenshots) | 1-2 |
| Testing on macOS, Windows, Linux | 1-2 |
| `vsce package` + Marketplace publish | 0.5 |
| **Total** | **~14-18 hours** |

A focused weekend for one developer. The prompt engineering block (task 2) is the highest-leverage and should not be compressed.

---

## 19. Deployment Plan

### Phase 1: Local development (Day 1)

- Scaffold extension with Yeoman (`yo code`)
- Implement SecretStorage key management
- Implement core rewrite command with hardcoded document type (README) to verify API round-trip
- Run 20 test cases manually via curl or OpenRouter Playground before wiring to extension

### Phase 2: Full V1 feature build (Day 1-2)

- Document type Quick Pick
- Diff view
- Changelog panel
- Status bar
- Error handling for all FR-08 cases
- Settings

### Phase 3: Pre-publish checklist (Day 2)

- [ ] API key is never written to any log or file
- [ ] All 20 test cases pass in the built extension
- [ ] Extension loads cleanly with no key set (onboarding triggers correctly)
- [ ] Extension loads cleanly with a valid key (no spurious prompts)
- [ ] All error states tested manually
- [ ] README explains what the tool does, what it does not do, and how to get an OpenRouter API key
- [ ] `package.json` `publisher`, `icon`, `categories`, `keywords` fields complete
- [ ] `vsce package` produces a clean `.vsix` with no warnings

### Phase 4: Publish

- Publish to VS Code Marketplace via `vsce publish`
- Post to: r/vscode, r/webdev, relevant developer newsletters (TLDR, JavaScript Weekly, Pointer)
- Open a GitHub repository with the source and link from the Marketplace listing
- Monitor reviews and issues for the first two weeks before any V2 work begins

### Phase 5: V2 decision gate

Review V1 success metrics (Section 16) at the 30-day mark. If V2 trigger criteria are met, begin Cloudflare Worker design. If not, collect qualitative feedback before building anything.

---

## 20. Open Questions

| # | Question | Owner | Due |
|---|---|---|---|
| 1 | What is the publisher name on VS Code Marketplace? | Product owner | Before Phase 3 |
| 2 | Will the source code be open source or closed? | Product owner | Before publish |
| 3 | Should the changelog panel show a diff summary or a structured list of rule violations? | Product owner | Before Phase 2 |
| 4 | Is `x-ai/grok-4.1-fast` the right default model for MVP, or should a higher-quality model (e.g. `anthropic/claude-sonnet-4-6` on OpenRouter) be used once traction is proven? | Engineering | Phase 2 |
| 5 | What is the exact heuristic for rejecting code selections (G5)? Token-based, file-type-based, or regex on selection content? | Engineering | Phase 1 |
| 6 | Domain name and branding for V2 backend and web presence? | Product owner | V2 start |

---

## 21. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-02-27 | — | Initial draft |
| 1.1 | 2026-02-27 | — | Switch inference provider from Anthropic to OpenRouter; change default model from claude-sonnet-4-6 to x-ai/grok-4.1-fast for MVP cost and speed |
| 1.2 | 2026-02-27 | — | Resolve open questions: diff UX (notification with Accept/Discard buttons), changelog format (structured rule violations), code detection (file-type + comment/string-literal token check), JSON output (json_object mode + prompt engineering) |

---

*This document is the single source of truth for the VS Code Anti-Slop Humanizer through V1 and V2. All scope decisions, architecture choices, and guardrail exceptions are recorded here. Update this document before changing direction, not after.*
