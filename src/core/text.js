'use strict';

function normalizeText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() + '\n';
}

/**
 * Parse significant (non-comment, non-blank) lines from gitignore content.
 * @param {string} content
 * @returns {string[]}
 */
function parseSignificantLines(content) {
  return normalizeText(content).split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

module.exports = { normalizeText, parseSignificantLines };
