import * as vscode from 'vscode';
import * as path from 'path';

const PROSE_EXTENSIONS = new Set(['.md', '.txt', '.markdown', '.text']);
const PROSE_FILENAMES = new Set(['license', 'readme', 'changelog', 'authors', 'contributors', 'notice', 'copying']);

// Languages where # is a line-comment marker. Unknown language IDs are
// treated conservatively so directive-style syntax is not rewritten as prose.
const HASH_COMMENT_LANGUAGES = new Set([
  'coffeescript',
  'dockerfile',
  'dotenv',
  'elixir',
  'git-commit',
  'git-rebase',
  'graphql',
  'ignore',
  'julia',
  'makefile',
  'perl',
  'perl6',
  'properties',
  'python',
  'r',
  'ruby',
  'shellscript',
  'tcl',
  'terraform',
  'yaml',
]);

type BlockDelim = '"""' | "'''" | '<#';

/**
 * Best-effort line-by-line block-state transition. Ignores string literals,
 * so `s = "abc"""` could be misread. Good enough for prose detection.
 */
export function nextBlockState(line: string, state: BlockDelim | null): BlockDelim | null {
  let i = 0;
  while (i < line.length) {
    if (state === null) {
      if (line.startsWith('"""', i)) { state = '"""'; i += 3; continue; }
      if (line.startsWith("'''", i)) { state = "'''"; i += 3; continue; }
      if (line.startsWith('<#', i))   { state = '<#';  i += 2; continue; }
    } else if (state === '"""' && line.startsWith('"""', i)) {
      state = null; i += 3; continue;
    } else if (state === "'''" && line.startsWith("'''", i)) {
      state = null; i += 3; continue;
    } else if (state === '<#' && line.startsWith('#>', i)) {
      state = null; i += 2; continue;
    }
    i++;
  }
  return state;
}

/**
 * Scans lines before startLine to determine whether the selection begins
 * inside an already-open block-comment delimiter.
 */
export function detectOpenBlockAbove(
  document: vscode.TextDocument,
  startLine: number
): BlockDelim | null {
  let state: BlockDelim | null = null;
  for (let i = 0; i < startLine; i++) {
    state = nextBlockState(document.lineAt(i).text, state);
  }
  return state;
}

/**
 * Returns true if the selection is prose and safe to rewrite.
 * - .md / .txt files: always prose.
 * - Source files: prose only if every selected line is a comment or
 *   lies inside a block-comment delimiter (""", ''', <# ... #>).
 */
export async function isProseSelection(
  document: vscode.TextDocument,
  selection: vscode.Selection
): Promise<boolean> {
  const fileName = document.fileName;
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex !== -1 ? fileName.slice(dotIndex).toLowerCase() : '';

  if (document.isUntitled || PROSE_EXTENSIONS.has(ext)) {
    return true;
  }

  const baseName = path.basename(fileName).toLowerCase();
  if (PROSE_FILENAMES.has(baseName)) {
    return true;
  }

  // Treat end-at-col-0 as exclusive: triple-click selections land at col 0
  // of the line after the last selected line.
  const endLine =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line - 1
      : selection.end.line;

  let hasProseLines = false;
  let insideBlock: BlockDelim | null = detectOpenBlockAbove(document, selection.start.line);

  for (let line = selection.start.line; line <= endLine; line++) {
    const lineText = document.lineAt(line).text.trim();

    if (lineText.length === 0) {
      continue;
    }

    if (insideBlock === null) {
      if (lineText.startsWith('"""')) {
        const rest = lineText.slice(3);
        insideBlock = rest.includes('"""') ? null : '"""';
        hasProseLines = true;
        continue;
      }
      if (lineText.startsWith("'''")) {
        const rest = lineText.slice(3);
        insideBlock = rest.includes("'''") ? null : "'''";
        hasProseLines = true;
        continue;
      }
      if (lineText.startsWith('<#')) {
        insideBlock = lineText.includes('#>') ? null : '<#';
        hasProseLines = true;
        continue;
      }

      if (!isCommentOrStringLine(lineText, document.languageId)) {
        return false;
      }
      hasProseLines = true;
    } else {
      if (insideBlock === '"""' && lineText.includes('"""')) {
        insideBlock = null;
      } else if (insideBlock === "'''" && lineText.includes("'''")) {
        insideBlock = null;
      } else if (insideBlock === '<#' && lineText.includes('#>')) {
        insideBlock = null;
      }
      hasProseLines = true;
    }
  }

  return hasProseLines;
}

/**
 * Returns true when the selection is in a source-code file AND
 * isProseSelection returns true. Used to auto-infer Docstring/Comment.
 */
export async function isCodeCommentSelection(
  document: vscode.TextDocument,
  selection: vscode.Selection
): Promise<boolean> {
  if (document.isUntitled) {
    return false;
  }

  const fileName = document.fileName;
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex !== -1 ? fileName.slice(dotIndex).toLowerCase() : '';

  if (PROSE_EXTENSIONS.has(ext)) {
    return false;
  }

  const baseName = path.basename(fileName).toLowerCase();
  if (PROSE_FILENAMES.has(baseName)) {
    return false;
  }

  return isProseSelection(document, selection);
}

export function isCommentOrStringLine(trimmedLine: string, languageId?: string): boolean {
  if (trimmedLine.startsWith('//')) { return true; }
  if (trimmedLine.startsWith('*')) { return true; }
  if (trimmedLine.startsWith('/*')) { return true; }
  if (trimmedLine.startsWith('"""')) { return true; }
  if (trimmedLine.startsWith("'''")) { return true; }
  if (trimmedLine.startsWith('--')) { return true; }
  if (trimmedLine.startsWith('<!--')) { return true; }
  if (trimmedLine.startsWith('//!')) { return true; }
  if (trimmedLine.startsWith('<#')) { return true; }
  if (trimmedLine.startsWith('#>')) { return true; }
  if (trimmedLine.startsWith('#')) {
    // Keep the no-language fallback for older callers, but only trust # as
    // a comment when the editor reports a language where that is syntax.
    return !languageId || HASH_COMMENT_LANGUAGES.has(languageId);
  }
  return false;
}
