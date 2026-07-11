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
  return String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    .filter(line => line.trim().length > 0 && !line.startsWith('#'));
}

module.exports = { normalizeText, parseSignificantLines };
