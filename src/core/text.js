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
    if (original.trim().length === 0 || original.startsWith('#')) continue;
    if (keepRaw) {
      out.push({ original });
    } else {
      out.push(original);
    }
  }
  return out;
}

/**
 * Expand simple bracket expressions in a pattern for matching purposes.
 *
 * Git's .gitignore supports bracket expressions like `[abc]` (match one of
 * a, b, c) and `?` (match any single character). Our pattern matcher
 * compares normalized strings for equality, so `*.pyc` won't match
 * `*.py[cod]` even though they're semantically overlapping.
 *
 * Rather than implement full glob matching (complex and fragile), we expand
 * the most common bracket patterns into a set of concrete alternatives.
 * This allows `normalizePattern('*.pyc')` to produce a form that matches
 * `normalizePattern('*.py[cod]')`.
 *
 * Supported expansions:
 *   - `[abc]` → produces one normalized form per character
 *   - `[a-z]` → produces one normalized form per character in range
 *   - `?`    → skipped (too many expansions; treat as literal)
 *
 * Returns an array of all expanded forms. For patterns without brackets,
 * the array has a single element (the pattern itself).
 *
 * @param {string} pattern - A normalized pattern (already trimmed/simplified)
 * @returns {string[]} - Array of expanded forms
 */
function expandBrackets(pattern) {
  const results = [];

  function expand(prefix, rest) {
    if (rest.length === 0) {
      results.push(prefix);
      return;
    }

    // Find the next bracket expression [...]
    const openIdx = rest.indexOf('[');
    if (openIdx === -1) {
      results.push(prefix + rest);
      return;
    }

    const closeIdx = rest.indexOf(']', openIdx);
    if (closeIdx === -1 || closeIdx === openIdx + 1) {
      // Malformed or empty bracket — treat as literal
      results.push(prefix + rest);
      return;
    }

    const before = rest.slice(0, openIdx);
    const bracketContent = rest.slice(openIdx + 1, closeIdx);
    const after = rest.slice(closeIdx + 1);

    // Expand the bracket content into individual characters
    const chars = [];
    for (let i = 0; i < bracketContent.length; i++) {
      // Check for range expression like a-z
      if (i + 2 < bracketContent.length && bracketContent[i + 1] === '-') {
        const start = bracketContent.charCodeAt(i);
        const end = bracketContent.charCodeAt(i + 2);
        if (start <= end && end - start <= 25) {
          // Limit ranges to 26 chars (a-z, A-Z, 0-9, etc.)
          for (let c = start; c <= end; c++) {
            chars.push(String.fromCharCode(c));
          }
          i += 2; // skip the range
          continue;
        }
      }
      chars.push(bracketContent[i]);
    }

    // Limit total expansions to prevent combinatorial explosion
    if (chars.length === 0 || (results.length > 0 && results.length * chars.length > 50)) {
      results.push(prefix + before + rest.slice(openIdx));
      return;
    }

    for (const ch of chars) {
      expand(prefix + before + ch, after);
    }
  }

  expand('', pattern);
  return results.length > 0 ? results : [pattern];
}

/**
 * Normalize a gitignore pattern for matching purposes.
 *
 * Preserve Git pattern syntax. Anchors, directory-only suffixes, negations,
 * and whitespace can change a rule's meaning, so adoption only treats exact
 * patterns as equal.
 *
 * @param {string} line
 * @returns {string}
 */
function normalizePattern(line) {
  return String(line).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Normalize a pattern and expand bracket expressions for matching.
 *
 * Returns an array of all concrete forms a pattern can take after bracket
 * expansion. For `*.py[cod]` this returns `['*.pyc', '*.pyo', '*.pyd']`.
 * For patterns without brackets, returns a single-element array.
 *
 * The matching engine uses this so that `*.pyc` in a user's .gitignore
 * matches `*.py[cod]` in a component definition.
 *
 * @param {string} line
 * @returns {string[]}
 */
function normalizePatternExpanded(line) {
  const normalized = normalizePattern(line);
  return expandBrackets(normalized);
}

module.exports = { normalizeText, parseSignificantLines, normalizePattern, normalizePatternExpanded, expandBrackets };
