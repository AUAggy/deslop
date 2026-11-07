import type { DocumentType } from '../types';

export const DOCUMENT_TYPES: readonly DocumentType[] = Object.freeze([
  'README', 'Docstring/Comment', 'Commit Message', 'Blog/Article',
]);

export function isDocumentType(value: unknown): value is DocumentType {
  return DOCUMENT_TYPES.some(type => type === value);
}

export interface DocumentTypeContext {
  readonly defaultDocumentType?: unknown;
  readonly fileName?: string;
  readonly languageId?: string;
  readonly isCodeComment?: boolean;
  readonly rememberDocumentType?: boolean;
  readonly lastDocumentType?: unknown;
}

export interface DocumentTypeResolution {
  readonly type: DocumentType | undefined;
  readonly source: 'default' | 'readme' | 'comment' | 'commit' | 'remembered' | 'picker';
}

/** Conservative context only. An arbitrary Markdown file is not a README. */
export function resolveDocumentType(context: DocumentTypeContext): DocumentTypeResolution {
  if (isDocumentType(context.defaultDocumentType)) {
    return { type: context.defaultDocumentType, source: 'default' };
  }
  const basename = (context.fileName ?? '').split(/[\\/]/).pop() ?? '';
  if (/^readme(?:\.(?:md|markdown|mdown|mkd|rst|txt))?$/i.test(basename)) {
    return { type: 'README', source: 'readme' };
  }
  if (context.isCodeComment === true) {
    return { type: 'Docstring/Comment', source: 'comment' };
  }
  if (context.languageId === 'git-commit' || /^(?:COMMIT_EDITMSG|MERGE_MSG|TAG_EDITMSG|SQUASH_MSG)$/.test(basename)) {
    return { type: 'Commit Message', source: 'commit' };
  }
  if (context.rememberDocumentType === true && isDocumentType(context.lastDocumentType)) {
    return { type: context.lastDocumentType, source: 'remembered' };
  }
  return { type: undefined, source: 'picker' };
}

/** Remembered ordering is not consent to automatic reuse. */
export function orderedDocumentTypes(last: unknown): DocumentType[] {
  return isDocumentType(last)
    ? [last, ...DOCUMENT_TYPES.filter(type => type !== last)]
    : [...DOCUMENT_TYPES];
}
