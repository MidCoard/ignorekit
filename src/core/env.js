'use strict';

/**
 * Extract standard I/O streams and cwd from an env object, falling back to
 * the process globals. Centralizes the pattern that was repeated in every
 * workflow and CLI entry point:
 *
 *   const stdout = env.stdout || process.stdout;
 *   const stderr = env.stderr || process.stderr;
 *   const cwd = env.cwd || process.cwd();
 *
 * This function is idempotent: calling it on an already-extracted result
 * (e.g. `{ stdout, stderr, cwd }` from a previous call) returns the same
 * values because the property lookup `(env && env.stdout) || process.stdout`
 * finds the existing stream and short-circuits. This means every function
 * boundary can safely call extractStreams as a safety net without risk of
 * double-wrapping or data loss — the first call in the chain resolves the
 * fallbacks, and subsequent calls are no-ops.
 *
 * Callers should invoke extractStreams at every function boundary where an
 * env object is received, even if the caller's parent already extracted the
 * streams. The idempotent guarantee makes this zero-cost in the happy path
 * while protecting against callers that pass a raw or partially-constructed
 * env (e.g. a test that omits stderr, or a CLI dispatch that forgets to
 * forward cwd).
 *
 * @param {object} [env] - Environment object with optional stdout, stderr, cwd.
 *   When env is null/undefined or lacks a property, the corresponding process
 *   global is used as a fallback so that no stream is ever undefined.
 * @returns {{ stdout: object, stderr: object, cwd: string }}
 */
function extractStreams(env) {
  return {
    stdout: (env && env.stdout) || process.stdout,
    stderr: (env && env.stderr) || process.stderr,
    cwd: (env && env.cwd) || process.cwd()
  };
}

module.exports = { extractStreams };
