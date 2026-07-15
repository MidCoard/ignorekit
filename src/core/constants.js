'use strict';

/**
 * Maximum size (in bytes) for a single .gitignore or template response.
 * Real files are a few KiB; the guard bounds worst-case memory and rejects
 * obviously-broken inputs before they can exhaust the buffer.
 */
const MAX_CONTENT_BYTES = 1024 * 1024;

module.exports = { MAX_CONTENT_BYTES };
