# Editorial evaluation v1

**Status: corpus and procedure prepared. No live baseline or preference evaluation has been run.** Both-provider results, human review, costs and partial-selection checks remain pending. This is not release acceptance evidence.

## Corpus and provenance

`corpus.cjs` contains 36 original synthetic passages. Each records its source, document type, provenance, permission, required invariants and reviewer expectations. No passage came from a private selection, volunteer or third-party publication. The fixtures are repository-authored material under the repository MIT license; names and scenarios are illustrative, not product claims.

The set includes clean writing, padded introductions, comments, commits, distinctive voice, accurate technical vocabulary, uncertainty, negation, numerical bounds, unsupported claims, identifiers, URLs, paths, fences, inline code, frontmatter and paragraph/list dependencies. Keep case IDs stable. Change the evaluation version when source text, expectations or the rubric change. A new prompt hash identifies a prompt change even if the corpus stays the same.

## Deterministic checks (no inference)

From the isolated feature checkout:

```sh
npm run compile
npm run lint
node --test evaluation/assets.test.cjs evaluation/editorial.test.cjs
```

The editorial TypeScript suite is `src/test/suite/editorial.test.ts`. Coordinate any full editor-suite run with other developers; do not launch competing GUI test instances. Corpus checks validate fixture shape and runner consent flags. The headless editorial adapter uses Node's built-in test runner with an explicit VS Code settings mock; it validates preference/type logic without launching an editor. Neither check evaluates writing quality or contacts a provider.

## Live runs: explicit, potentially billable

Do not run this procedure without the account owner's approval. Every selected passage makes one provider completion request; a complete matrix can make hundreds. Cancellation or a failed response may still incur charges. The runner disables automatic retries and stops after a request/response failure.

1. Compile the exact checkout being evaluated. Record its commit ID with the results. The runner loads local compiled system prompt, modifiers, preference instructions and integrity checks, not the installed extension.
2. Choose a provider and explicit model ID. The current configured defaults are `openai/gpt-6-luna` for OpenRouter and `openai-gpt-6-luna` for Venice. These are configuration values, not a verified promise of current access. Confirm model availability and prices in your account before authorising a run.
3. Explicitly populate the dedicated `DESLOP_EVALUATION_API_KEY` environment variable with a disposable test credential using a secret manager or private hidden-input process. Never put a literal key in command arguments, shell history, files, notes or screenshots. The runner reads this variable only when explicitly named with `--key-env`, after both usage acknowledgements; it refuses other variable names. It never consults `OPENAI_API_KEY`, settings, SecretStorage or your installed extension's credentials. Unset the evaluation variable and revoke the disposable key afterwards.
4. Choose a new result filename outside the repository. Results deliberately persist synthetic outputs for evaluation; this differs from the extension's in-memory review. Do not substitute private prose.
5. Start with one case and an explicit usage acknowledgement:

```sh
node evaluation/run.cjs --live --acknowledge-charges \
  --provider openrouter --model openai/gpt-6-luna \
  --key-env DESLOP_EVALUATION_API_KEY \
  --output /absolute/private/deslop-one-case.jsonl \
  --prompt deslop --preferences off --case clean-readme
```

Omit `--case` only after approving a full 36-case run. Use `--prompt clearer --preferences off` for the simple “make this clearer” comparison. Use `--preferences punctuation`, `structure` or `both` for paired preference runs with the DeSlop prompt. Repeat with Venice and its explicitly selected model. Do not compare outputs from stale compiled assets.

### Required matrix before sign-off

| Run | OpenRouter selected model | Venice selected model |
|---|---|---|
| DeSlop, preferences off, all cases | Pending | Pending |
| Simple clearer prompt, all cases | Pending | Pending |
| Punctuation off/on, voice cases | Pending | Pending |
| Structure off/on, structure cases | Pending | Pending |
| Both on, voice and conflicting document-type cases | Pending | Pending |
| All four combinations, structure-conflict case | Pending | Pending |
| Representative mixed partial subsets in editor | Pending | Pending |

The runner records evaluation version, case ID, provider, resolved model, timestamp, full effective preferences, exact prompt SHA-256, raw rewritten output, cleaned output, sanitised model explanations, invisible/confusable cleanup counts, protected-content issues, latency, token usage when returned, and a pending reviewer record. Explanations describe the full proposal, not a safety proof or a mapping to partial groups. The runner uses the extension's OpenRouter attribution headers and explicitly disables SDK logging, including inherited debug logging. It does not retain raw provider errors. Monetary cost is explicitly **unavailable**, not zero. Add provider billing evidence, or a labelled estimate with dated token rates, calculation, currency and assumptions; do not present an estimate as an invoice. Record timeouts/failures as observations, not omitted successes.

## Human rubric

Compare source against the cleaned output that the extension would display, while inspecting raw output for protected-content failures. Reviewers must read the entire passage. Mechanical checks are not a proof of meaning preservation. For each dimension record `pass`, `minor concern`, or `material failure`, a source/output excerpt and rationale:

- **Reader effort:** is the claim, instruction or sequence easier to find? Shorter is not automatically better.
- **Meaning and qualifications:** preserve negation, conditions, attribution, scope, comparison direction and uncertainty.
- **Technical completeness:** retain preconditions, exceptions, return values, units, numerical bounds, operation order and case-sensitive identifiers.
- **Confidence:** no invented evidence, examples, guarantees, mechanisms or stronger certainty. Do not silently accept a weaker or narrower claim either. Unsupported-claim cases expose a potential prompt/meaning conflict; adjudicate it explicitly rather than calling it a harmless style edit.
- **Voice:** keep purposeful rhythm, spelling, humour, stance and distinctive punctuation unless a higher-priority requirement conflicts.
- **Unnecessary change:** clean cases should remain unchanged unless a reviewer identifies a concrete reader-facing improvement with no meaning/voice loss. Cosmetic churn alone is a failure of minimal intervention.
- **Preference adherence:** inspect requested punctuation and paragraph/list organisation. Record any conflict with meaning, document type or protected content; preferences are requests, not exact guarantees.

**Hard failure:** changed or missing protected content, material meaning change, unsupported addition, or an unsafe composed partial result. A runner status of `awaiting-human-review` is not a pass. Literal invariant strings guide review; synonyms are not automatically failures, and presence of every string is not proof of correctness.

### Partial acceptance

In the development host, inspect the exact composed preview for representative subsets: each independent group alone; a mixed include/exclude choice; all selected; none selected; and dependent list/qualification edits. Confirm all equals the full validated proposal and none equals source without an edit. Read combinations for broken references, lost negation, contradictory clauses and changed scope. If grouping blocks a subset, record the message and whether the grouping is understandable. Model explanations describe the full proposal, not necessarily the chosen subset.

## Findings and release disposition

For each observation record: run/case ID, reviewer/date, dimension, severity, source/output excerpt, full or selected group IDs, disposition, fix owner and retest evidence. Do not include keys, callbacks or private prose. Keep unresolved findings visible; do not delete an awkward case to obtain a passing set.

Release sign-off requires human review of the agreed release set on both providers/default selected models, no unresolved material meaning/protected-content failures, no unexplained clean-prose churn, and documented preference/partial-selection findings. A second reviewer should adjudicate material or disputed cases. Numerical detector or “slop” scores are not used.

**Current findings:** not yet assessed. Absence of findings is not evidence of quality; live runs and human reviews are pending.
