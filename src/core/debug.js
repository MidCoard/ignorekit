'use strict';

/**
 * Emit a stderr debug line when IGNOREKIT_DEBUG is set. Used inside
 * catch blocks that intentionally swallow an error to keep the program
 * running. When the user opts in they get the suppressed error message
 * without changing the production behavior.
 *
 * When an `env` object with a `stderr` writable stream is provided, output
 * goes to that stream instead of `process.stderr`. This keeps debug output
 * consistent with the rest of the CLI's stream routing — tests that capture
 * stderr via env.stderr will also capture debugError output rather than
 * having it leak to the real process.stderr.
 *
 * @param {Error|unknown} err
 * @param {string} [label] - Short context tag (e.g. "analysis", "preset")
 * @param {object} [env] - Environment streams
 * @param {object} [env.stderr] - Writable stream for debug output (default: process.stderr)
 */
function debugError(err, label = '', env) {
  if (!process.env.IGNOREKIT_DEBUG) return;
  const tag = label ? `[ignorekit:${label}]` : '[ignorekit]';
  const message = err && err.message ? err.message : String(err);
  const stderr = (env && env.stderr) || process.stderr;
  stderr.write(`${tag} ${message}\n`);
}

module.exports = { debugError };
