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
