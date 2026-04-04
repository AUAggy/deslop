import * as vscode from 'vscode';
import * as path from 'path';

const PROSE_EXTENSIONS = new Set(['.md', '.txt', '.markdown', '.text']);
const PROSE_FILENAMES = new Set(['license', 'readme', 'changelog', 'authors', 'contributors', 'notice', 'copying']);

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

  // Check extensionless plain-text files by base name
  const baseName = path.basename(fileName).toLowerCase();
  if (PROSE_FILENAMES.has(baseName)) {
    return true;
  }

  let hasProseLines = false;
  let insideBlock: '"""' | "'''" | '<#' | null = null;

  for (let line = selection.start.line; line <= selection.end.line; line++) {
    const lineText = document.lineAt(line).text.trim();

    if (lineText.length === 0) {
      continue;
    }

    // Handle block-delimiter state machine
    if (insideBlock === null) {
      // Check if this line opens a block we track
      if (lineText.startsWith('"""')) {
        // May open and close on the same line ("""...""")
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

      // Not inside a block — must be a recognised comment line
      if (!isCommentOrStringLine(lineText)) {
        return false;
      }
      hasProseLines = true;
    } else {
      // Inside a block — check for closing delimiter
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
 * Returns true when the selection is in a source-code file (not .md, .txt,
 * or other prose extensions) AND isProseSelection returns true.
 *
 * Used by humanize.ts to infer 'Docstring/Comment' without prompting the user.
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

export function isCommentOrStringLine(trimmedLine: string): boolean {
  return (
    trimmedLine.startsWith('//') ||
    trimmedLine.startsWith('#') ||
    trimmedLine.startsWith('*') ||
    trimmedLine.startsWith('/*') ||
    trimmedLine.startsWith('"""') ||
    trimmedLine.startsWith("'''") ||
    trimmedLine.startsWith('--') ||
    trimmedLine.startsWith('<!--') ||
    trimmedLine.startsWith('//!') ||  // Rust doc comments
    trimmedLine.startsWith('<#') ||   // PowerShell block comment opener
    trimmedLine.startsWith('#>')       // PowerShell block comment closer
  );
}
