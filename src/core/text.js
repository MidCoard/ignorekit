'use strict';

function normalizeText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() + '\n';
}

/**
 * Parse significant (non-comment, non-blank) lines from gitignore content.
 *
 * With `keepRaw` false (the default) the return is a flat array of source
 * strings in the order they appear; callers that match rules compare with
 * `line.trim()` so trailing whitespace and casing do not silently break a
 * match.
 *
 * With `keepRaw` true each returned entry is `{ original }` — the source
 * byte text verbatim, preserved so adopt (and any other carry-forward
 * caller) can round-trip trailing whitespace and quoting that the user's
 * source file actually contained. The `original` field is the same string
 * the comparison form is derived from (`.trim()`), so callers do not need a
 * separate "normalized" key. Earlier versions of this function returned
 * `{ normalized, original }` with both fields equal to the raw line; that
 * was misleading and has been simplified.
 *
 * Behavioral note: indented comment lines (e.g. "  # comment") are now
 * correctly skipped because the comment check runs on `trimmed`. Earlier
 * versions only skipped lines whose original text started with "#", so
 * indented comments were incorrectly treated as significant rules. This
 * aligns with git's own .gitignore parsing, which treats any line whose
 * trimmed form starts with "#" as a comment regardless of leading
 * whitespace.
 *
 * @param {string} content
 * @param {object} [opts]
 * @param {boolean} [opts.keepRaw] - Return `{original}` objects instead of strings
 * @returns {string[] | {original: string}[]}
 */
function parseSignificantLines(content, { keepRaw = false } = {}) {
  const split = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const original of split) {
    const trimmed = original.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (keepRaw) {
      out.push({ original });
    } else {
      out.push(original);
    }
  }
  return out;
}

/**
 * Normalize a gitignore pattern for matching purposes.
 *
 * Applies these transformations so semantically equivalent patterns are
 * treated as the same rule:
 *
 * 1. Trim leading and trailing whitespace — Git ignores leading whitespace
 *    in patterns (unless escaped), so stripping it is consistent with how
 *    Git resolves the rule.
 *
 * 2. Strip trailing slashes — Git treats "dir/" and "dir" identically for
 *    matching; the slash only restricts the pattern to directories, which
 *    doesn't affect which files get ignored. Stripping the slash allows
 *    ".codegraph" in a user's .gitignore to match ".codegraph/" in a
 *    component definition.
 *
 * 3. Strip leading slashes — In gitignore, "/pattern" anchors the match to
 *    the repository root, while "pattern" matches at any level. For matching
 *    purposes (does this rule cover the same thing?), they are equivalent:
 *    both ignore files/dirs named "pattern". Stripping the leading slash
 *    allows "/nbproject/private/" in a user's .gitignore to match
 *    "nbproject/private/" in a component definition.
 *
 * 4. Strip trailing "/*" — "dirname/*" and "dirname/" are semantically
 *    equivalent for matching: both ignore everything inside the directory.
 *    The "/*" form is used when negation rules follow (e.g. ".vscode/*"
 *    then "!.vscode/settings.json"), but the parent pattern itself covers
 *    the same files as "dirname/". Stripping "/*" allows ".vscode/" in a
 *    user's .gitignore to match ".vscode/*" in a component definition.
 *
 * @param {string} line
 * @returns {string}
 */
function normalizePattern(line) {
  return line.trim().replace(/^\/+/, '').replace(/\/\*+$/, '').replace(/\/+$/, '');
}

module.exports = { normalizeText, parseSignificantLines, normalizePattern };
