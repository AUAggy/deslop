# Testing the development workflow

**Feature-preview acceptance guide. All manual checks below are pending until someone records a result.** This guide does not authorise a release, a merge to `main`, paid inference or access to existing credentials. Use synthetic text unless you deliberately choose otherwise.

## Keep the installed extension and main checkout unchanged

Use an isolated feature checkout and an Extension Development Host. Do not install a VSIX, update the Marketplace extension, run a publishing command or switch the main checkout. The development host should use a separate profile and extensions directory so its DeSlop instance cannot be confused with your installed copy.

**Credential boundary:** a disposable editor profile does not guarantee a separate SecretStorage/keychain namespace. Before invoking any connection, PKCE, model-test or rewrite command, use either an independent OS account/VM credential service or a development test harness that explicitly mocks credentials and inference. Otherwise a stored key can be reused and billed before any setup prompt appears. Do not inspect an existing key to establish isolation. Separate approval is still required for billable requests.

1. Open the isolated feature checkout in VS Code. Check `git branch --show-current` and `git status`; do not use `main`. Follow the repository's dependency policy. A shared `node_modules` symlink is read-only: do not install into it.
2. Run `npm run test:deterministic` (compiles, lints and runs the headless workflow, connection, review, editorial, request-contract and SDK-privacy checks). No provider calls occur in these tests. See [evaluation/README.md](evaluation/README.md) for editorial coverage. For the complete editor suite, coordinate a single GUI run and record the editor version, actual test count, exit code and any post-test cleanup error separately.
3. Run `npm run bundle` in this checkout. The extension entry point is `dist/extension.js`; compiling TypeScript alone is not the development-host runtime bundle.
4. Use a temporary launch configuration in this checkout, or start VS Code from a terminal with separate directories. For example on a machine with the `code` CLI:

   ```sh
   DEV_PROFILE=$(mktemp -d "${TMPDIR:-/tmp}/deslop-dev-profile.XXXXXX")
   DEV_EXTENSIONS=$(mktemp -d "${TMPDIR:-/tmp}/deslop-dev-extensions.XXXXXX")
   code --new-window --user-data-dir "$DEV_PROFILE" \
     --extensions-dir "$DEV_EXTENSIONS" \
     --extensionDevelopmentPath="$PWD"
   ```

   Verify the new window says **Extension Development Host** and the running extension points to this checkout. Do not use `--install-extension`. Keep the temporary directories private; close the host and remove them after testing. Deleting a profile may not remove a SecretStorage credential from the platform's credential service: explicitly Disconnect test credentials first. Never assume a new editor profile proves a separate keychain namespace.
5. Open a scratch folder with synthetic README, source comment, article and commit-message examples. Do not open a real project containing secrets. Do not invoke credential-capable commands until the independent OS/VM credential service or explicit credential/inference mocks are established. Do not inspect, test, replace or disconnect any pre-existing credential. For an approved live test, create a disposable provider credential only in that isolated environment, approve potential charges separately, and revoke it afterwards. Browser authorisation must also use the intended test account.

An isolated profile does not itself prove PKCE callback routing or SecretStorage isolation. Multiple windows, remote hosts and editor-specific credential services need explicit checks. Record the actual destination without recording callback query values.

## Recorded automated integration evidence

On 2026-11-07, the integrated feature tree passed compile, lint, bundle and its deterministic checks. A disposable-profile extension-host run on **VS Code 1.144.0, macOS arm64** passed **211 tests**, exit 0. Of these, seven use actual editor APIs: read-only virtual diff/native typing/external-edit restoration and close; tab return/cancel; group closure; duplicate-view closure; exact composed source replacement and one Undo; version-change refusal; and bundled command registration. The remaining tests are unit or boundary-fake tests, even though they ran inside an editor host. Credential and inference boundaries were explicitly mocked before workflow invocation; application cases also supply deterministic review choices. Native workflow tests call compiled modules directly; bundled activation checks registration only. A keyboard/palette review-to-application walkthrough remains pending. No extension credential lookup, provider request, browser authorisation or paid evaluation was performed.

Headless checks separately passed: 22 workflow cases; 39 connection-boundary cases plus 46 connection/model unit cases; 34 review cases; 14 editorial/asset cases; 32 request/evaluation comparisons plus consent/contribution checks; and the actual SDK against five mocked fetches with debug logging enabled and zero emitted logs. Counts overlap the editor suite and must not be added together as independent coverage.

The editor test CLI was invoked directly with disposable user-data, extensions and workspace paths. The normal `npm run test`/posttest cleanup chain was not run, so this is not a claim that its historical macOS cleanup error is resolved. Public APIs compile against installed `@types/vscode` 1.110.0; runtime execution at the minimum editor version is still pending. These automated results do not close the manual walkthrough or the partial-selection implementation blocker.

## Walkthrough: source, review and recovery

Record `pass`, `fail`, or `pending`, exact build/commit and editor version for each check. A mock test does not establish a manual pass.

| Check | Expected observation | Status |
|---|---|---|
| First use | Select prose, press **Shift+Alt+D**; complete approved connection setup without reselecting | Pending |
| Manual setup | OpenRouter and Venice each retain their own test credential; cancel leaves source unchanged | Pending |
| OpenRouter browser setup | Account/credits notice, callback in intended host, successful resume; denial/cancel/expiry recover safely | Pending |
| Type resolution | Explicit default wins; README/comment/commit contexts infer; arbitrary Markdown asks | Pending |
| Remembered type | Last choice reorders only by default; explicit user setting enables reuse; invalid stored value asks | Pending |
| Unchanged passage | “No changes needed”; no edit or review | Pending |
| Native preview | Read-only original/proposal, no dirty untitled buffer or save request | Pending |
| Explanations | Available before acceptance; labelled model-generated and not exhaustive | Pending |
| Partial selection | Select/clear/include/exclude groups; displayed composition equals applied text | Pending |
| All/none | All equals full proposal; none performs no source edit | Pending |
| Protected subset | Unsafe fence/frontmatter/list boundary combinations blocked, never silently added | Pending |
| Keyboard and tabs | Find review controls without mouse; switching tabs cannot retarget Apply; two groups behave safely | Pending |
| Discard/close | Source untouched, no stranded active operation or review buttons | Pending |
| Cancellation | During setup/request; late result ignored; possible usage charges explained | Pending |
| Retry | Same captured source/type/provider/model/preferences, no surprise new picker | Pending |
| Preferences | Independently enable each, both, reset; repository settings cannot enable them | Pending |
| Regeneration | Changing pending type/preferences warns about another potentially billable request; failure retains prior result | Pending |
| Source drift | Edit or close source during request/review; Apply blocked; explicit Copy Result/Discard available | Pending |
| Failed application | Simulate with a development-only test harness; no success message, completed result retained | Pending |
| One-step undo | Successful Apply is undone by one Undo, restoring exact original | Pending |
| Overlap | Second invocation returns to the active operation rather than starting another request | Pending |
| Key replacement | Cancel/invalid candidate preserves working test key; replacement affects captured provider only | Pending |
| Disconnect | Confirmation required, only intended test provider removed | Pending |
| Reload | No prose restored from disk or falsely resumable request | Pending |

### Known partial-selection blocker

The current implementation does not provide useful fine-grained selection for most formatted READMEs. Any recognised protected content or markup delimiter anywhere in the passage collapses it to a single whole-rewrite group. Unchanged headings, inline code, triple-quoted docstrings, lists, quotes, tables, emphasis, links and HTML can trigger this fallback. Plain-text changes on separate physical lines can be selectable when unchanged lines separate them; same-line edits cannot be split. A newline-count change among multiple groups, or more than 250,000 line-pair comparison cells, also causes whole-rewrite fallback. The title, status and picker disclose the group count/reason.

For partial-selection testing, include both a plain multiline example that genuinely offers multiple groups and an ordinary formatted README that demonstrates the limitation. Record the latter as a remaining implementation blocker, not as a successful granular README review. Structural safety checks do not prove semantic independence. If native EOL normalisation prevents an exact preview, Apply is blocked rather than silently normalising excluded text; copy the completed result or discard.

Do not induce failure by modifying a live extension or real credentials. Use mocked provider/error boundaries for deterministic failure checks; mark real UI validation pending when no safe harness is available.

## Compatibility matrix

The manifest minimum is VS Code 1.110.0. These are test targets, not claims of completed support. Name an alternative editor before claiming compatibility; registry availability is not evidence that callbacks or partial review work there.

| Editor/environment | Exact version | PKCE | Manual fallback | Review/partial selection | Preferences | Limits |
|---|---|---|---|---|---|---|
| VS Code minimum, local | 1.110.0 | Pending | Pending | Pending | Pending | Full finished-build walkthrough required |
| VS Code current, local | 1.144.0, macOS arm64 | Pending | Pending | Automated LF-only native checks passed; manual controls/subsets pending | Deterministic checks passed; live pending | No live callback/credential-host claim; coarse README grouping remains a blocker |
| VS Code Remote SSH | To record local + remote host versions | Pending | Pending | Pending | Pending | Record browser location, external URI route and credential owner without secrets |
| VS Code Dev Container | To record host + container versions | Pending | Pending | Pending | Pending | Same routing/ownership checks as SSH |
| Alternative compatible editor | Not selected | Untested | Untested | Untested | Untested | No compatibility claim |

Also test lost browser session, callback to the wrong window, browser-open failure, editor reload and multiple open windows. Use manual entry when supported recovery is offered; never weaken callback validation to make a test pass.

## Screenshots

Refresh screenshots only after final review controls are wired. Capture a synthetic README rewrite, a partial selection, current explanations and preference choices. Check every image for account details, keys, callbacks, filenames revealing private work and notifications. Do not reuse an old screenshot as evidence of a new UI. **Updated screenshots: pending.**

## Volunteer study: preparation, not completed research

Recruit 5–8 adults who already write in supported editors, including developers and adjacent writers where possible. Participation is voluntary and withdrawal needs no explanation. Offer synthetic passages and a disposable test environment; participants need not expose their own writing, account or credential. Do not charge a participant without their explicit agreement.

Before observing, read and obtain agreement to this consent statement:

> We are testing the editing workflow, not your writing ability. With your permission, we will take notes about actions, delays, confusing controls and your feedback. Do not share keys, authorisation callbacks or private text. You may use synthetic passages, skip any task or stop at any time. We will not record your screen/audio or retain your selected prose unless we ask separately and you explicitly agree. Notes use a participant code, not your name. You can ask us to delete your notes before the agreed retention deadline. No silent telemetry is added.

Agree a retention/deletion date before starting and store notes outside the repository with access limited to the study team. Record consent date and participant code, not identity or secret-bearing screenshots. Separate permission is required for any quotation in a public report.

Without coaching, ask each participant to:

1. Connect using approved PKCE in the primary environment, or manual fallback where suitable.
2. Select a passage and request a rewrite; record avoidable prompts and setup completion.
3. Find explanations, include/exclude groups, inspect the composed preview and apply a subset.
4. Undo once, then discard a different result.
5. Change punctuation/structure preferences and explicitly regenerate after the cost notice.
6. Cancel replacement of a test credential, then replace it successfully.
7. Recover from a safely simulated request or stale-source failure.

Record task completion, time or delays when useful, missed controls, partial-selection misunderstandings, manual restorations, recovery outcome and voluntary intent to reuse. Ask why they would choose this over their current assistant. Use observations, not a success percentage from a small convenience sample. Do not collect participant prose, API keys or callback values in diagnostic notes.

**Study status: not recruited, not run; no volunteer observations available.**

## Acceptance and release preparation

This checklist is preparation only. Do not publish, merge, bump a version, tag, package a release or install over the live extension from this guide.

- [ ] Compile/lint/deterministic checks and one coordinated editor suite have recorded outcomes; post-test cleanup errors identified separately.
- [ ] Manual walkthrough completed, including failed application, close/cancel, keyboard review, partial selection, stale source, undo and rotation.
- [ ] Primary-editor PKCE works end to end; remote/editor matrix updated with actual versions and limits.
- [ ] Both providers/default selected models reviewed under the [editorial rubric](evaluation/README.md), including comparison, preferences and mixed partial subsets.
- [ ] No unresolved source-loss, credential exposure, wrong-target, misleading partial-selection, material-meaning or protected-content defects.
- [ ] Consent-based study completed or explicitly still blocking acceptance; findings redacted, assigned and retested.
- [ ] README command labels/settings checked against final contributions; synthetic screenshots refreshed.
- [ ] User reviews E2E evidence and explicitly approves a PR merge to main. No automatic merge.
- [ ] A separately authorised release operator reads the authoritative private publishing, Marketplace and maintenance procedures before any release action. This public guide does not replace them or reserve a version number.
- [ ] Later release evidence records attached artifacts, registry publication and post-publish listing checks separately from local tests.

Until the pending gates are resolved, describe the work as a feature preview, not release-ready.
