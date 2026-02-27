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
