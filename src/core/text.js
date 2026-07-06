'use strict';

function normalizeText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() + '\n';
}

module.exports = { normalizeText };
