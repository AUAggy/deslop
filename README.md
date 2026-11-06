<p align="center">
  <img src="images/icon.png" width="96" alt="DeSlop">
</p>

<h1 align="center">DeSlop</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=AUAggy.deslop">VS Code Marketplace</a> ·
  <a href="https://open-vsx.org/extension/AUAggy/deslop">Open VSX</a> ·
  <a href="https://github.com/AUAggy/deslop/releases">Released versions</a>
</p>

Edit AI-assisted prose inside your editor, review the changes, and keep control of the result. DeSlop rewrites selected READMEs, comments, commit messages and article passages using your chosen provider and model.

**Feature-preview branch:** the connection, partial-review and preference workflow described below requires integration and development-host testing. It is not a claim about the current Marketplace release. Live editorial evaluations, PKCE/editor compatibility, volunteer observations and updated screenshots remain pending. See [Testing the development workflow](TESTING.md) to try this checkout without replacing your installed extension or changing main.

## Getting started

1. Open a document and **select the prose first**. Press **Shift+Alt+D**, choose **DeSlop: DeSlop Selection** from the Command Palette, or use the selection's context menu.
2. If no credential is stored, connect to the chosen provider. OpenRouter browser authorisation requires your own OpenRouter account and credits; it does not provide free inference. Manual API-key entry remains available for OpenRouter and Venice. Your pending selection stays in memory while setup completes.
3. Confirm the document type if asked. An explicit default wins; recognised README filenames, source comments and commit-message editors can avoid the picker. An arbitrary Markdown filename is not treated as a README. Your last choice only changes picker order unless you explicitly enable automatic reuse.
4. Review the read-only native diff. **Show Current Changes** opens model-generated explanations; they are aids, not an exhaustive edit list or a safety guarantee.
5. Use **Select Change Groups** to include or exclude actual text changes. Inspect the resulting preview, then **Apply Selected Changes**. Use **Accept Full Rewrite** to take the whole proposal, or **Discard Rewrite** to leave source unchanged. Selecting no groups makes no source edit. Group selection does not make another model request.
6. After a successful application, one **Undo** restores the original selection.

Review is enabled by default. Keep it enabled when testing partial acceptance. Read the exact composed result: combining individually reasonable edits can still change meaning. Protected-content checks can block unsafe combinations, but they cannot prove that the prose says what you intend.

## Connections, cancellation and recovery

Open **DeSlop: Manage Connection** from the Command Palette to connect, replace a credential, test the connection, open the provider account or disconnect. A stored key and a successful connection test are different states; neither guarantees credit or access to a particular model. Any completion-based model test must disclose potential charges before it runs.

- **OpenRouter:** browser authorisation exchanges directly with OpenRouter, with no DeSlop credential-handling backend. Manual entry is the fallback when callback routing is unavailable. Primary-editor and remote routing still require live verification in this feature preview.
- **Venice:** enter a Venice API key manually. Keys are stored separately for each provider.
- **Replace:** cancelling or rejecting a candidate must leave the working credential intact. The legacy Reset API Key entry point becomes safe replacement, not immediate deletion.
- **Disconnect:** removes only the identified provider's credential after confirmation.

Cancel setup or inference to leave source unchanged. Cancellation may not prevent provider charges already incurred. Retry retains the captured source, document type, provider/model and editorial preferences; changing a setting elsewhere must not redirect a pending operation.

If the source changes or closes, DeSlop must not apply the old result to it. Use the explicit **Copy Reviewed Result** recovery action or discard it. A failed application is not a successful rewrite. Closing review discards the pending choice. Pending work is not restored after an extension reload.

## Editorial preferences

Open **DeSlop: Configure Editorial Preferences** to choose either preference, both, or reset both to off:

- **Preserve punctuation style:** asks the model to retain legitimate choices such as curly quotes and deliberate dash usage.
- **Preserve paragraph/list structure:** asks it to keep paragraph boundaries, list order and nesting where possible.

Both default **off** and persist only through an explicit user choice at user scope. Workspace and language overrides cannot enable them. Review shows the captured choices. Changing them does not alter a completed proposal: applying new preferences requires explicit regeneration and another potentially billable request. A failed regeneration must retain the prior completed result.

These are bounded editorial requests, not exact formatting guarantees. Meaning, qualifications, protected content, document-type requirements and output-integrity checks take precedence. Invisible or confusable characters prohibited by the checks are not retained to satisfy punctuation style. DeSlop does not infer a voice profile, learn from accepted selections or archive writing samples.

## What gets edited

The prompt targets filler, inflated framing, repetitive templates and decorative formatting. Vocabulary flags require context: “robust estimator”, “critical section” and “public key” are legitimate technical terms, not automatic errors. A useful contrast or a genuine question may belong in the text. Punctuation is not evidence of authorship.

Code fences, inline code and recognised YAML frontmatter receive mechanical protected-content checks. Those checks reject detected protected-content changes and remove prohibited invisible/confusable characters outside protected regions. They do **not** establish semantic equivalence or verify facts. Check identifiers, paths, URLs, numbers, conditions and negation in the preview.

### Examples

These are synthetic illustrations of editing choices, **not recorded live-model outputs**. The [evaluation corpus](evaluation/README.md) contains the testable cases and reviewer rubric.

**README, full acceptance**

Before:

> It is worth noting that Parcelnote searches release notes in a local folder.

Illustrative proposal:

> Parcelnote searches release notes in a local folder.

Accept the full rewrite when removing the lead-in is the only desired change. Do not add speed, indexing or collaboration claims absent from the source.

**Comment, narrow edit**

Before:

```ts
// It is important to note that this returns the first match, or undefined if none exists.
```

Illustrative proposal:

```ts
// Return the first match, or undefined if none exists.
```

The return cases must survive. The code block here illustrates a comment selection; fenced code in an actual prose selection is protected rather than rewritten.

**Article, partial acceptance**

Before:

> It is worth noting that the queue was empty. I went home—at last.

Suppose a proposal removes the lead-in and also changes the deliberate dash. If those edits are independent groups, include the lead-in removal, exclude the punctuation change, and inspect:

> The queue was empty. I went home—at last.

Not every textual difference can safely be split. Dependent structural/protected changes may appear as one group. The displayed composed preview, not the model's explanations, is the text to check before applying.

**Already clean**

> The cache is local to each process, not shared across workers.

Leaving this unchanged is a valid result. A rewrite should not be required just to prove that a request ran.

## Settings

The new settings below are part of the feature-preview wiring; check the final contributions during acceptance.

| Setting | Default | Behaviour |
|---|---|---|
| `deslop.provider` | `openrouter` | Select OpenRouter or Venice; each needs its own credential. |
| `deslop.model` | Provider-specific | When unset, the configured defaults are `openai/gpt-6-luna` on OpenRouter and `openai-gpt-6-luna` on Venice. Explicit overrides win. Availability and price depend on your provider/account. |
| `deslop.defaultDocumentType` | `null` | Explicit type takes precedence. Otherwise use high-confidence context, enabled remembered choice, or picker. |
| `deslop.rememberDocumentType` | `false` | User-only opt-in to reuse the last explicitly picked type after context inference. Otherwise that choice only reorders the picker. |
| `deslop.preservePunctuationStyle` | `false` | User-only punctuation-style request; subordinate to safety and document type. |
| `deslop.preserveParagraphListStructure` | `false` | User-only paragraph/list organisation request, not an exact guarantee. |
| `deslop.showChangeLog` | `false` in the preview | Do not automatically open explanations for new users. An existing explicit user preference is respected. |
| `deslop.autoAccept` | `false` | User-only full-rewrite opt-in that skips review. Partial acceptance requires review. |

The four types remain **README**, **Docstring/Comment**, **Commit Message** and **Blog/Article**. The command palette also provides **Return to Review**, **Inspect Full Proposal**, **Show Current Changes**, and **Show Last Changes**. Action labels must be checked against the final integrated build; no command-ID lookup is needed for normal use.

## Privacy and costs

Selected prose, the system prompt, document type and enabled preference instructions are sent to your selected provider over HTTPS using your credential. Inference is funded through your provider account. Authentication/connection checks and browser authorisation can also contact the provider. Provider and upstream model-service policies apply; review them before sending confidential text. DeSlop does not promise a provider's retention policy on its behalf.

Credentials use VS Code SecretStorage, not repository settings. The credential service and ownership depend on the editor/extension-host environment. Do not share API keys, authorisation codes or callback URLs in bug reports.

The extension adds no telemetry and does not deliberately archive selected prose or pending results. Review and recovery keep prose in memory for the active session, not a DeSlop-managed draft history. The editor/platform's own storage, crash handling and clipboard policies are separate. Copying a result is an explicit action. The opt-in evaluation runner separately writes only its synthetic test results to a user-chosen file.

## Limits and verification

- Prose selections only; source-code selections are rejected. The current guard is 16,000 characters, roughly 3,000 words depending on the text.
- No factual verification, missing-evidence invention, guaranteed meaning preservation or detector-evasion promise.
- One active rewrite at a time; no automatic file-wide rewrite, writing-profile onboarding or hosted DeSlop inference.
- An internet connection and a provider account with appropriate access/credit are required.
- Registry listing or installation in another editor does not prove callback/review compatibility. The [versioned compatibility matrix](TESTING.md#compatibility-matrix) currently labels untested environments and pending primary-editor checks.
- Editorial evaluations, consent-based volunteer observations, final screenshots and manual release gates remain pending. See [Testing](TESTING.md) and [Editorial evaluation](evaluation/README.md).

## License

MIT. See [LICENSE](LICENSE).
