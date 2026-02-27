import * as vscode from 'vscode';

const PROSE_EXTENSIONS = new Set(['.md', '.txt', '.markdown', '.text']);

/**
 * Returns true if the selection is prose and safe to rewrite.
 * - .md / .txt files: always prose.
 * - Source files: prose only if every selected line starts as a comment or
 *   the selection is entirely within a string literal (detected via line heuristic).
 */
export async function isProseSelection(
  document: vscode.TextDocument,
  selection: vscode.Selection
): Promise<boolean> {
  const fileName = document.fileName;
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

  if (PROSE_EXTENSIONS.has(ext)) {
    return true;
  }

  let hasProseLines = false;

  for (let line = selection.start.line; line <= selection.end.line; line++) {
    const lineText = document.lineAt(line).text.trim();
    if (lineText.length === 0) {
      continue;
    }
    if (!isCommentOrStringLine(lineText)) {
      return false;
    }
    hasProseLines = true;
  }

  return hasProseLines;
}

function isCommentOrStringLine(trimmedLine: string): boolean {
  return (
    trimmedLine.startsWith('//') ||
    trimmedLine.startsWith('#') ||
    trimmedLine.startsWith('*') ||
    trimmedLine.startsWith('/*') ||
    trimmedLine.startsWith('"""') ||
    trimmedLine.startsWith("'''") ||
    trimmedLine.startsWith('--') ||
    trimmedLine.startsWith('<!--') ||
    trimmedLine.startsWith('//!')  // Rust doc comments
  );
}
