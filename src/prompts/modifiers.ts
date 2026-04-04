import type { DocumentType } from '../types';

export const MODIFIERS: Record<DocumentType, string> = {
  README: `DOCUMENT TYPE — README:
Technical and direct. The reader is a developer evaluating whether to use the project. Lead with what the project does, not what it is. No mission statements.`,

  'Docstring/Comment': `DOCUMENT TYPE — DOCSTRING/COMMENT:
You are rewriting documentation that lives inside source code.

PRESERVE STRUCTURE:
Keep all structural markers exactly as-is. Never add, remove, or reorder them. Rewrite only the text associated with them. This includes (but is not limited to): JSDoc tags (@param, @returns, @throws, @example, @deprecated, @see, @type, @since), Python section headers (Args:, Returns:, Raises:, Notes:, Examples:) and their indentation, PowerShell help keywords (.SYNOPSIS, .DESCRIPTION, .PARAMETER, .EXAMPLE), RST directives (:param:, :type:, :returns:, :raises:), C# XML tags (<summary>, <param>, <returns>, <exception>).
Preserve @example blocks character-for-character — some toolchains execute them.
Preserve the comment syntax characters (///, /**, *, #, """) and indentation.

WHAT TO CUT:
- Preambles that restate the function name: "This function...", "This method...", "This class...", "The purpose of this..." — cut the preamble and start with the imperative verb.
- @param descriptions that only restate the type already in the signature: "@param userId string — the userId" → rewrite to describe the value's meaning and constraints.
- @returns descriptions that only restate the return type.
- Passive constructions: "is used to", "is responsible for", "is designed to", "is intended to" → cut to the verb.
- Any sentence that adds no information beyond what the type signature already declares.

BANNED PATTERNS (code documentation specific):
"A helper function that", "A utility that", "Handles the logic for", "Responsible for", "Takes care of", "Allows you to", "Provides a way to", "Note: this function", "Please note that", "Wraps X to" (unless the wrapping behaviour is the point).

WHAT TO KEEP AND STRENGTHEN:
- Constraints the signature cannot express: nullability, valid ranges, ordering requirements, side effects, thread safety, units.
- The why behind non-obvious behaviour — if a choice was made for a reason, say the reason.
- @throws / Raises: the conditions that trigger the exception, not just the exception name.
- Deprecation notices: preserve the replacement path and the reason.

STYLE:
- Imperative mood for the summary line: "Parse the config file" not "Parses the config file" and not "This function parses the config file."
- One clear summary sentence. Expand in subsequent lines only when behaviour is genuinely complex.
- Present tense for stable behaviour.`,

  'Commit Message': `DOCUMENT TYPE — COMMIT MESSAGE:
Subject line: 50 characters max, imperative mood, no trailing period. Body (if present): explains why, not what. Max 72 characters per body line.`,

  'Blog/Article': `DOCUMENT TYPE — BLOG/ARTICLE:
Allow slightly more personality than other types. Short paragraphs. Personal observations are acceptable. Avoid listicle structure unless the content genuinely is a list.`,
};
