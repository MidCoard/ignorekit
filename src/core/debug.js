'use strict';

/**
 * Emit a stderr debug line when IGNOREKIT_DEBUG is set. Used inside
 * catch blocks that intentionally swallow an error to keep the program
 * running. When the user opts in they get the suppressed error message
 * without changing the production behavior.
 *
 * @param {Error|unknown} err
 * @param {string} [label] - Short context tag (e.g. "analysis", "preset")
 */
function debugError(err, label = '') {
  if (!process.env.IGNOREKIT_DEBUG) return;
  const tag = label ? `[ignorekit:${label}]` : '[ignorekit]';
  const message = err && err.message ? err.message : String(err);
  process.stderr.write(`${tag} ${message}\n`);
}

module.exports = { debugError };
