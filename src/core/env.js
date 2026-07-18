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
 * @param {object} [env] - Environment object with optional stdout, stderr, cwd
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
