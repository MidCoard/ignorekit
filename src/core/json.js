'use strict';

const fs = require('fs');
const path = require('path');
const { debugError } = require('./debug');
const { MAX_CONTENT_BYTES } = require('./constants');

/**
 * Check file size before reading. Files larger than MAX_CONTENT_BYTES are
 * rejected to prevent memory exhaustion from pathological inputs (e.g. a
 * corrupted 10 GiB JSON that readFileSync would buffer entirely before
 * JSON.parse even runs). Real config and preset files are a few KiB.
 *
 * @param {string} filePath
 * @throws {Error} If the file exceeds MAX_CONTENT_BYTES
 */
function checkSize(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_CONTENT_BYTES) {
    const err = new Error(`File too large (${stat.size} bytes > ${MAX_CONTENT_BYTES}): ${filePath}`);
    err.code = 'EFILETOOLARGE';
    throw err;
  }
}

function readJson(filePath) {
  try {
    checkSize(filePath);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`Failed to read JSON ${filePath}: ${error.message}`);
    if (error.code) wrapped.code = error.code;
    throw wrapped;
  }
}

/**
 * Read and parse a JSON file, returning null if the file does not exist
 * or cannot be parsed.
 *
 * ENOENT (file not found) is the expected case — the caller has a fallback
 * path and null signals "use the fallback".
 *
 * Non-ENOENT errors (EACCES, invalid JSON, etc.) are also surfaced to the
 * caller as null to preserve the function's contract, but are logged under
 * IGNOREKIT_DEBUG so a misconfigured permission or a corrupt JSON file is
 * visible without changing the return-type contract. Callers that need to
 * distinguish "absent" from "broken" should use readJson() instead.
 *
 * The name "OrNull" (rather than "IfPresent") makes the contract explicit:
 * null means "no valid JSON available", which covers both "file absent" and
 * "file present but unreadable". The previous name "readJsonIfPresent"
 * implied null only meant "file not present", which was a footgun when the
 * file existed but contained invalid JSON.
 */
function readJsonOrNull(filePath, env) {
  try {
    checkSize(filePath);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    // Size-guard errors indicate a file that is likely corrupted or malicious.
    // Returning null would silently mask the problem — the caller would proceed
    // without data and never know the file was rejected for being oversized.
    // Re-throw so the caller can surface the issue immediately.
    // Detection uses err.code rather than string-matching the message so that
    // changing the error format in checkSize doesn't silently break this check.
    if (err && err.code === 'EFILETOOLARGE') throw err;
    // Non-ENOENT errors (EACCES, SyntaxError from invalid JSON, etc.) are
    // unexpected — surface them under IGNOREKIT_DEBUG so the user can diagnose
    // permission issues or corrupt config files, but still return null to
    // preserve the contract.
    debugError(err, `readJsonOrNull.${filePath}`, env);
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

module.exports = { readJson, readJsonOrNull, writeJson };
