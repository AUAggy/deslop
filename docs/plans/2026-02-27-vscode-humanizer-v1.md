# VS Code Humanizer V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VS Code extension with a single "Humanize Selection" command that rewrites selected prose via OpenRouter (x-ai/grok-4.1-fast) to remove AI writing patterns.

**Architecture:** TypeScript VS Code extension. User selects text → chooses document type (Quick Pick) → extension calls OpenRouter API with a rules-laden system prompt → opens native diff view + Accept/Discard notification → on Accept, replaces selection and logs rule violations to an Output Channel. API key stored exclusively in `vscode.SecretStorage`.

**Tech Stack:** TypeScript, VS Code Extension API, `openai` npm package (pointed at OpenRouter base URL), `vsce` for packaging.

---

## Prerequisites (do once before Task 1)

```bash
npm install -g yo generator-code @vscode/vsce
node --version   # must be >= 18 for native fetch
```

---

### Task 1: Scaffold the extension

**Files:**
- Create: entire project root via `yo code`

**Step 1: Run the Yeoman generator**

```bash
cd /Users/aggy/Documents/other-projects/wip/vscode-humanize
yo code
```

Yeoman prompts — answer exactly as follows:
- What type of extension? → **New Extension (TypeScript)**
- Extension name → `humanizer`
- Identifier → `humanizer`
- Description → `Rewrites selected prose to remove AI writing patterns`
- Initialize git repo? → **No** (we manage git ourselves)
- Bundle with webpack? → **No**
- Package manager → **npm**

This creates the scaffold inside a `humanizer/` subfolder. Move its contents to the project root:

```bash
cp -r humanizer/. . && rm -rf humanizer
```

**Step 2: Install the openai package**

```bash
npm install openai
```

**Step 3: Verify the scaffold compiles**

```bash
npm run compile
```

Expected: exit 0, no TypeScript errors.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold VS Code extension with yo code"
```

---

### Task 2: Define shared types

**Files:**
- Create: `src/types.ts`

**Step 1: Create the file**

```typescript
// src/types.ts

export interface ChangeEntry {
  pattern: string;
  action: string;
}

export interface HumanizeResponse {
  rewritten: string;
  changes: ChangeEntry[];
}

export type DocumentType =
  | 'README'
  | 'Docstring/Comment'
  | 'Commit Message'
  | 'Blog/Article';
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared TypeScript types"
```

---

### Task 3: SecretStorage wrapper

**Files:**
- Create: `src/storage/secrets.ts`

**Step 1: Create the file**

```typescript
// src/storage/secrets.ts
import * as vscode from 'vscode';

const KEY = 'humanizer.openrouterApiKey';

export async function getApiKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  return secrets.get(KEY);
}

export async function setApiKey(
  secrets: vscode.SecretStorage,
  key: string
): Promise<void> {
  await secrets.store(KEY, key);
}

export async function deleteApiKey(
  secrets: vscode.SecretStorage
): Promise<void> {
  await secrets.delete(KEY);
}
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/storage/secrets.ts
git commit -m "feat: add SecretStorage wrapper for API key"
```

---

### Task 4: System prompt and document-type modifiers

**Files:**
- Create: `src/prompts/system.ts`
- Create: `src/prompts/modifiers.ts`

**Step 1: Create system.ts**

```typescript
// src/prompts/system.ts

export const SYSTEM_PROMPT = `You are a technical prose editor. Your only job is to rewrite the text inside <source_text> tags to remove AI-generated writing patterns and produce clear, direct technical prose.

RULES — apply all of these:

BANNED TERMS (replace or remove entirely):
delve, leverage, paradigm shift, robust, seamless, cutting-edge, state-of-the-art, revolutionize, empower, disruptive, innovative, groundbreaking, game-changer, transformative, synergy, ecosystem, holistic, scalable, agile, dynamic, facilitate, utilize (use "use" instead), implement (use "use" or "build" when "use" suffices), enhance, optimize, streamline, granular, pivotal, seminal, intricate, plethora, myriad, henceforth, aforementioned.
Also banned: marketing superlatives (best, fastest, easiest, most powerful) without specific evidence.

BANNED PADDING PHRASES (remove entirely):
"it's worth noting", "importantly", "it is important to note", "it should be noted that", "as a matter of fact", "in fact", "actually", "basically", "essentially", "simply put", "in other words", "to put it simply", "that is to say", "for all intents and purposes", "at the end of the day", "when it comes to", "in terms of", "with that said", "having said that", "be that as it may".
Excessive hedging sequences: remove chains of should/might/could/probably/possibly/perhaps/maybe/likely/potentially/arguably.

BANNED CLICHÉ FORMATS:
- "Question? Answer." sentence structure
- "This isn't X. It's Y."
- "In a world where..." / "Imagine a world..."
- "Let's face it:" / "Here's the thing:" / "The truth is:"
- "At its core:" / "Say goodbye to X and hello to Y."
- Anthropomorphism applied to code or tools
- Em-dashes as clause connectors or inline asides (replace with colon, semicolon, comma, or rewrite)

STYLE RULES:
- Active voice and imperative mood for instructions
- "in order to" → "to"; "due to the fact that" → "because"
- Replace vague terms with specific language
- Vary sentence length: mix short declarative with longer explanatory
- Define technical terms on first use
- Present tense for stable features, future tense for planned ones, past tense for history
- No first-person (I/we) or second-person (you) outside direct instructions
- No exclamation points

OUTPUT FORMAT:
You MUST respond with ONLY a JSON object — no markdown fences, no explanation before or after. The JSON must have exactly two fields:
{
  "rewritten": "<the full rewritten text>",
  "changes": [
    { "pattern": "<what was changed>", "action": "<why / what rule applies>" }
  ]
}

If no changes are needed, return the original text in "rewritten" and an empty "changes" array.`;
```

**Step 2: Create modifiers.ts**

```typescript
// src/prompts/modifiers.ts
import type { DocumentType } from '../types';

export const MODIFIERS: Record<DocumentType, string> = {
  README: `DOCUMENT TYPE — README:
Technical and direct. The reader is a developer evaluating whether to use the project. Lead with what the project does, not what it is. No mission statements.`,

  'Docstring/Comment': `DOCUMENT TYPE — DOCSTRING/COMMENT:
Precision over completeness. Describe what the function does, its parameters, and return values. Remove any commentary that restates what the code already shows.`,

  'Commit Message': `DOCUMENT TYPE — COMMIT MESSAGE:
Subject line: 50 characters max, imperative mood, no trailing period. Body (if present): explains why, not what. Max 72 characters per body line.`,

  'Blog/Article': `DOCUMENT TYPE — BLOG/ARTICLE:
Allow slightly more personality than other types. Short paragraphs. Personal observations are acceptable. Avoid listicle structure unless the content genuinely is a list.`,
};
```

**Step 3: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 4: Commit**

```bash
git add src/prompts/system.ts src/prompts/modifiers.ts
git commit -m "feat: add system prompt and document-type modifiers"
```

---

### Task 5: OpenRouter API client

**Files:**
- Create: `src/api/openrouter.ts`

**Step 1: Create the file**

```typescript
// src/api/openrouter.ts
import OpenAI from 'openai';
import * as vscode from 'vscode';
import { SYSTEM_PROMPT } from '../prompts/system';
import { MODIFIERS } from '../prompts/modifiers';
import type { DocumentType, HumanizeResponse } from '../types';

const MAX_TOKENS_INPUT = 4000;
// Rough heuristic: 1 token ≈ 4 chars
const MAX_CHARS = MAX_TOKENS_INPUT * 4;

export function isSelectionTooLong(text: string): boolean {
  return text.length > MAX_CHARS;
}

export async function callHumanize(
  apiKey: string,
  text: string,
  docType: DocumentType
): Promise<HumanizeResponse> {
  const config = vscode.workspace.getConfiguration('humanizer');
  const model = config.get<string>('model', 'x-ai/grok-4.1-fast');

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/humanizer-vscode',
      'X-Title': 'VS Code Humanizer',
    },
  });

  const systemPrompt = `${SYSTEM_PROMPT}\n\n${MODIFIERS[docType]}`;

  const response = await client.chat.completions.create(
    {
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `<source_text>\n${text}\n</source_text>`,
        },
      ],
    },
    { timeout: 20000 }
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error('Empty response from API');
  }

  let parsed: HumanizeResponse;
  try {
    parsed = JSON.parse(raw) as HumanizeResponse;
  } catch {
    throw new Error('API returned invalid JSON');
  }

  if (typeof parsed.rewritten !== 'string' || !Array.isArray(parsed.changes)) {
    throw new Error('API response missing required fields');
  }

  return parsed;
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    await client.chat.completions.create(
      {
        model: 'x-ai/grok-4.1-fast',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      },
      { timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
}
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/api/openrouter.ts
git commit -m "feat: add OpenRouter API client with json_object mode"
```

---

### Task 6: Status bar indicator

**Files:**
- Create: `src/ui/statusBar.ts`

**Step 1: Create the file**

```typescript
// src/ui/statusBar.ts
import * as vscode from 'vscode';

let statusItem: vscode.StatusBarItem | undefined;

export function showSpinner(context: vscode.ExtensionContext): void {
  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0
    );
    context.subscriptions.push(statusItem);
  }
  statusItem.text = '$(loading~spin) Humanizing...';
  statusItem.show();
}

export function hideSpinner(): void {
  statusItem?.hide();
}
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/ui/statusBar.ts
git commit -m "feat: add status bar spinner"
```

---

### Task 7: Changelog output channel

**Files:**
- Create: `src/ui/changelog.ts`

**Step 1: Create the file**

```typescript
// src/ui/changelog.ts
import * as vscode from 'vscode';
import type { ChangeEntry } from '../types';

let channel: vscode.OutputChannel | undefined;

export function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Humanizer: Changes');
  }
  return channel;
}

export function logChanges(changes: ChangeEntry[]): void {
  const ch = getChannel();
  if (changes.length === 0) {
    ch.appendLine('[No rule violations found — text already clean]');
  } else {
    changes.forEach((c) => {
      ch.appendLine(`• ${c.pattern} — ${c.action}`);
    });
  }
  ch.appendLine('');
  ch.show(true); // preserve focus on editor
}

export function disposeChannel(): void {
  channel?.dispose();
  channel = undefined;
}
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/ui/changelog.ts
git commit -m "feat: add changelog output channel"
```

---

### Task 8: Diff view handler

**Files:**
- Create: `src/ui/diff.ts`

VS Code's `vscode.diff` opens a read-only side-by-side diff. Accept/Discard is handled via an information message shown alongside it.

**Step 1: Create the file**

```typescript
// src/ui/diff.ts
import * as vscode from 'vscode';

/**
 * Opens a native VS Code diff view between two in-memory documents,
 * then prompts the user to Accept or Discard via a notification.
 * Returns true if accepted, false if discarded.
 */
export async function showDiffAndPrompt(
  original: string,
  rewritten: string
): Promise<boolean> {
  // Create two untitled URIs so vscode.diff can display them
  const originalUri = vscode.Uri.parse(
    `untitled:humanizer-original-${Date.now()}.txt`
  );
  const rewrittenUri = vscode.Uri.parse(
    `untitled:humanizer-rewritten-${Date.now()}.txt`
  );

  // Register content providers for these one-shot URIs
  const provider = new SingleUseProvider({ originalUri, original, rewrittenUri, rewritten });
  const reg1 = vscode.workspace.registerTextDocumentContentProvider('untitled', provider);

  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    rewrittenUri,
    'Humanizer: Review Changes'
  );

  const choice = await vscode.window.showInformationMessage(
    'Accept the rewrite?',
    { modal: false },
    'Accept',
    'Discard'
  );

  reg1.dispose();

  // Close the diff tab
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

  return choice === 'Accept';
}

class SingleUseProvider implements vscode.TextDocumentContentProvider {
  private map: Map<string, string>;

  constructor(opts: {
    originalUri: vscode.Uri;
    original: string;
    rewrittenUri: vscode.Uri;
    rewritten: string;
  }) {
    this.map = new Map([
      [opts.originalUri.toString(), opts.original],
      [opts.rewrittenUri.toString(), opts.rewritten],
    ]);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.map.get(uri.toString()) ?? '';
  }
}
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/ui/diff.ts
git commit -m "feat: add diff view with Accept/Discard notification"
```

---

### Task 9: Onboarding flow (API key prompt)

**Files:**
- Create: `src/commands/onboarding.ts`

**Step 1: Create the file**

```typescript
// src/commands/onboarding.ts
import * as vscode from 'vscode';
import { getApiKey, setApiKey } from '../storage/secrets';
import { validateApiKey } from '../api/openrouter';

/**
 * Ensures a valid API key is stored. Returns the key, or undefined if the
 * user cancelled or validation failed.
 */
export async function ensureApiKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const existing = await getApiKey(secrets);
  if (existing) {
    return existing;
  }

  const action = await vscode.window.showInformationMessage(
    'Humanizer needs an OpenRouter API key. Enter it now or get one at openrouter.ai/keys.',
    'Enter Key',
    'Get Key'
  );

  if (action === 'Get Key') {
    vscode.env.openExternal(vscode.Uri.parse('https://openrouter.ai/keys'));
    return undefined;
  }

  if (action !== 'Enter Key') {
    return undefined;
  }

  return promptAndSaveKey(secrets);
}

export async function promptAndSaveKey(
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    prompt: 'Paste your OpenRouter API key',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-or-...',
  });

  if (!key) {
    return undefined;
  }

  const valid = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Validating API key...',
      cancellable: false,
    },
    () => validateApiKey(key)
  );

  if (!valid) {
    const retry = await vscode.window.showErrorMessage(
      'API key not valid. Check your key at openrouter.ai/keys.',
      'Try Again'
    );
    if (retry === 'Try Again') {
      return promptAndSaveKey(secrets);
    }
    return undefined;
  }

  await setApiKey(secrets, key);
  vscode.window.showInformationMessage('Key saved. Ready to humanize.');
  return key;
}
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/commands/onboarding.ts
git commit -m "feat: add API key onboarding flow"
```

---

### Task 10: Code detection helper

**Files:**
- Create: `src/util/isProseSelection.ts`

**Step 1: Create the file**

```typescript
// src/util/isProseSelection.ts
import * as vscode from 'vscode';

const PROSE_FILE_EXTENSIONS = new Set(['.md', '.txt', '.markdown', '.text']);

/**
 * Returns true if the selection should be treated as prose (safe to rewrite).
 * - Always true for .md / .txt files.
 * - In source files: true only if every character in the selection is
 *   covered by a comment or string token type.
 */
export async function isProseSelection(
  document: vscode.TextDocument,
  selection: vscode.Selection
): Promise<boolean> {
  const ext = document.fileName.slice(document.fileName.lastIndexOf('.'));
  if (PROSE_FILE_EXTENSIONS.has(ext.toLowerCase())) {
    return true;
  }

  // For source files, check token types at start and end of selection
  const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
    'vscode.provideDocumentSemanticTokens',
    document.uri
  );

  // If no semantic tokens available, fall back to checking VSCode's built-in
  // scope inspection at the selection start
  if (!tokens) {
    return isCommentOrStringScope(document, selection.start);
  }

  // Check start and end positions
  return (
    isCommentOrStringScope(document, selection.start) &&
    isCommentOrStringScope(document, selection.end)
  );
}

function isCommentOrStringScope(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  // Use the grammar scope at position to determine if it's inside a comment or string
  // vscode.languages.getTokenAtPosition is not public API; use line text heuristic
  // as a pragmatic fallback for V1
  const lineText = document.lineAt(position.line).text.trim();
  return (
    lineText.startsWith('//') ||
    lineText.startsWith('#') ||
    lineText.startsWith('*') ||
    lineText.startsWith('/*') ||
    lineText.startsWith('"""') ||
    lineText.startsWith("'''") ||
    lineText.startsWith('--') // SQL comment
  );
}
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/util/isProseSelection.ts
git commit -m "feat: add prose vs code detection helper"
```

---

### Task 11: Core humanize command

**Files:**
- Create: `src/commands/humanize.ts`

**Step 1: Create the file**

```typescript
// src/commands/humanize.ts
import * as vscode from 'vscode';
import { ensureApiKey, promptAndSaveKey } from './onboarding';
import { callHumanize, isSelectionTooLong } from '../api/openrouter';
import { showDiffAndPrompt } from '../ui/diff';
import { showSpinner, hideSpinner } from '../ui/statusBar';
import { logChanges } from '../ui/changelog';
import { isProseSelection } from '../util/isProseSelection';
import type { DocumentType } from '../types';

const DOC_TYPE_ITEMS: Array<{ label: string; value: DocumentType }> = [
  { label: 'README', value: 'README' },
  { label: 'Docstring / Comment', value: 'Docstring/Comment' },
  { label: 'Commit Message', value: 'Commit Message' },
  { label: 'Blog / Article', value: 'Blog/Article' },
];

let lastDocType: DocumentType | undefined;

export async function humanizeSelection(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Open a file and select text to humanize.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showErrorMessage(
      'Select the text you want to humanize first.'
    );
    return;
  }

  const selectedText = editor.document.getText(selection);

  // G5: reject code selections
  const prose = await isProseSelection(editor.document, selection);
  if (!prose) {
    vscode.window.showErrorMessage(
      'Humanizer rewrites prose, not code. Select a comment or documentation block.'
    );
    return;
  }

  // Token length guard
  if (isSelectionTooLong(selectedText)) {
    vscode.window.showErrorMessage(
      'Selection exceeds ~3,000 words. Select a shorter passage.'
    );
    return;
  }

  // API key
  const apiKey = await ensureApiKey(context.secrets);
  if (!apiKey) {
    return;
  }

  // Document type
  const config = vscode.workspace.getConfiguration('humanizer');
  const defaultType = config.get<DocumentType | null>('defaultDocumentType', null);

  let docType: DocumentType | undefined = defaultType ?? lastDocType;

  if (!docType) {
    const picked = await vscode.window.showQuickPick(
      DOC_TYPE_ITEMS.map((i) => i.label),
      { placeHolder: 'Select document type' }
    );
    if (!picked) {
      return;
    }
    docType = DOC_TYPE_ITEMS.find((i) => i.label === picked)!.value;
  }

  lastDocType = docType;

  // Inference
  showSpinner(context);
  let result;
  try {
    result = await callHumanize(apiKey, selectedText, docType);
  } catch (err: unknown) {
    hideSpinner();
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('timed out') || msg.includes('timeout')) {
      const action = await vscode.window.showErrorMessage(
        'Request timed out. Check your connection and try again.',
        'Retry'
      );
      if (action === 'Retry') {
        return humanizeSelection(context);
      }
      return;
    }

    if (msg.includes('401') || msg.includes('403') || msg.includes('invalid_api_key')) {
      const action = await vscode.window.showErrorMessage(
        'API key rejected. Check your key at openrouter.ai/keys.',
        'Update Key'
      );
      if (action === 'Update Key') {
        await promptAndSaveKey(context.secrets);
      }
      return;
    }

    const action = await vscode.window.showErrorMessage(
      'OpenRouter API returned an error. Try again in a moment.',
      'Retry'
    );
    if (action === 'Retry') {
      return humanizeSelection(context);
    }
    return;
  } finally {
    hideSpinner();
  }

  // Diff view
  const accepted = await showDiffAndPrompt(selectedText, result.rewritten);
  if (!accepted) {
    return;
  }

  // Replace selection in editor
  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, result.rewritten);
  });

  // Changelog
  const showLog = config.get<boolean>('showChangeLog', true);
  if (showLog) {
    logChanges(result.changes);
  }
}
```

**Step 2: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add src/commands/humanize.ts
git commit -m "feat: add core humanize selection command"
```

---

### Task 12: Extension entry point and package.json manifest

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

**Step 1: Replace src/extension.ts**

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { humanizeSelection } from './commands/humanize';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    'humanizer.humanizeSelection',
    () => humanizeSelection(context)
  );
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // nothing to clean up
}
```

**Step 2: Update package.json contributes section**

In `package.json`, replace the entire `"contributes"` key with:

```json
"contributes": {
  "commands": [
    {
      "command": "humanizer.humanizeSelection",
      "title": "Humanize Selection",
      "category": "Humanizer"
    }
  ],
  "menus": {
    "editor/context": [
      {
        "command": "humanizer.humanizeSelection",
        "when": "editorHasSelection",
        "group": "1_modification"
      }
    ]
  },
  "configuration": {
    "title": "Humanizer",
    "properties": {
      "humanizer.model": {
        "type": "string",
        "default": "x-ai/grok-4.1-fast",
        "description": "OpenRouter model to use for rewrites."
      },
      "humanizer.defaultDocumentType": {
        "type": ["string", "null"],
        "enum": [null, "README", "Docstring/Comment", "Commit Message", "Blog/Article"],
        "default": null,
        "description": "Pre-select document type; null means always prompt."
      },
      "humanizer.showChangeLog": {
        "type": "boolean",
        "default": true,
        "description": "Show changelog panel after each accepted rewrite."
      },
      "humanizer.autoAccept": {
        "type": "boolean",
        "default": false,
        "description": "Skip diff view and replace text immediately."
      }
    }
  }
}
```

Also update `"activationEvents"` in package.json to:

```json
"activationEvents": ["onCommand:humanizer.humanizeSelection"]
```

And set `"main"` to `"./out/extension"`.

**Step 3: Compile**

```bash
npm run compile
```

Expected: exit 0.

**Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: wire extension entry point and package.json manifest"
```

---

### Task 13: Package and verify

**Step 1: Package the extension**

```bash
vsce package
```

Expected: a `.vsix` file is produced with no errors. Check that it is under 2MB:

```bash
ls -lh *.vsix
```

**Step 2: Install locally for manual testing**

```bash
code --install-extension humanizer-*.vsix
```

**Step 3: Manual smoke test checklist**

- [ ] Open VS Code with a `.md` file
- [ ] Select a paragraph of AI-sounding prose
- [ ] Run "Humanize Selection" from command palette
- [ ] Onboarding prompt appears (first run) — enter an OpenRouter key
- [ ] Document type Quick Pick appears
- [ ] Status bar shows "Humanizing..."
- [ ] Diff view opens showing original vs rewritten
- [ ] Accept notification appears — click Accept
- [ ] Editor text replaced
- [ ] Changelog output channel shows rule violations
- [ ] Run again — no onboarding prompt (key persisted)
- [ ] Select code in a `.ts` file outside a comment — confirm rejection message

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: package v1.0.0 — clean vsce build"
```

---

## Rollback Points

| Commit message | Safe rollback to |
|---|---|
| `chore: scaffold VS Code extension` | Before any feature code |
| `feat: add OpenRouter API client` | Before API integration |
| `feat: add core humanize selection command` | Before command wiring |
| `feat: wire extension entry point` | Before manifest changes |
