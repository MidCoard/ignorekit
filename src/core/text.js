'use strict';

function normalizeText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() + '\n';
}

/**
 * Parse significant (non-comment, non-blank) lines from gitignore content.
 *
 * When `keepRaw` is true, each returned entry is `{ normalized, original }`.
 * The `normalized` value is the comparison form used for matching; the
 * `original` value preserves the source byte text verbatim so adopt (and any
 * other carry-forward caller) can preserve trailing whitespace / casing that
 * the user's source file actually contained. With `keepRaw` false the return
 * is the plain array of strings — the default, preserved for compatibility.
 *
 * @param {string} content
 * @param {object} [opts]
 * @param {boolean} [opts.keepRaw] - Return `{normalized, original}` objects
 * @returns {string[] | {normalized: string, original: string}[]}
 */
function parseSignificantLines(content, { keepRaw = false } = {}) {
  const split = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const original of split) {
    const trimmed = original.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (keepRaw) {
      out.push({ normalized: original, original });
    } else {
      out.push(original);
    }
  }
  return out;
}

module.exports = { normalizeText, parseSignificantLines };
