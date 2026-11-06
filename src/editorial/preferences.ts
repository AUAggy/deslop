export interface EditorialPreferences {
  readonly preservePunctuationStyle: boolean;
  readonly preserveParagraphListStructure: boolean;
}

export interface UserSettingInspector {
  inspect(key: string): { globalValue?: unknown } | undefined;
}

/** Only explicit user choices count; repositories and language overrides cannot opt in. */
export function resolveEditorialPreferences(config: UserSettingInspector): EditorialPreferences {
  return Object.freeze({
    preservePunctuationStyle: config.inspect('preservePunctuationStyle')?.globalValue === true,
    preserveParagraphListStructure: config.inspect('preserveParagraphListStructure')?.globalValue === true,
  });
}

/** Empty means the existing, disabled-preference prompt path is unchanged. */
export function buildPreferenceInstructions(preferences: EditorialPreferences): string {
  const instructions: string[] = [];
  if (preferences.preservePunctuationStyle) {
    instructions.push('Preserve the source’s legitimate punctuation style (such as curly quotes and deliberate dash usage) where compatible with the document type. Do not introduce new stylistic punctuation.');
  }
  if (preferences.preserveParagraphListStructure) {
    instructions.push('Retain the source’s paragraph boundaries and list organisation where possible, including list order and nesting. Do not merge or split paragraphs or convert lists to prose merely to shorten the text.');
  }
  if (!instructions.length) { return ''; }
  return [
    'USER EDITORIAL PREFERENCES (bounded requests, not guarantees)',
    'Meaning, facts, necessary qualifications, protected content, document-type requirements, and mechanical output-integrity checks take precedence over these preferences. Never retain prohibited invisible or confusable characters to satisfy a preference. If a conflict requires a change, explain it in the changes array.',
    ...instructions,
  ].join('\n');
}

export function describeEditorialPreferences(preferences: EditorialPreferences): string {
  return `Punctuation style: ${preferences.preservePunctuationStyle ? 'preserve' : 'default'}; paragraph/list structure: ${preferences.preserveParagraphListStructure ? 'preserve' : 'default'}`;
}
