'use strict';

const readline = require('readline');

const DEFAULT_PROMPT = 'Proceed? [y/N/cancel] (N): ';

/**
 * Interpret a confirmation answer.
 *
 * Only an explicit yes proceeds; empty input, an explicit no, and cancel all
 * decline. Cancel is treated the same as no here — callers that need to
 * distinguish a deliberate cancel from a plain decline handle it separately.
 *
 * @param {string} answer
 * @returns {boolean}
 */
function interpretConfirm(answer) {
  const v = String(answer == null ? '' : answer).trim().toLowerCase();
  if (v === 'y' || v === 'yes') return true;
  // empty, n/no, c/cancel → decline
  return false;
}

/**
 * Build a confirm() callback for a workflow env, or return null when no prompt
 * should be shown (non-interactive input).
 *
 * Resolution order, matching how the CLI wires input:
 * 1. A test-provided ask() function drives the prompt synchronously.
 * 2. A real TTY prompts the user via readline.
 * 3. Piped/non-TTY input skips confirmation entirely (returns null).
 *
 * @param {object} env - { stdout, stdin, ask }
 * @param {object} [opts]
 * @param {string} [opts.prompt] - Prompt text
 * @returns {(() => Promise<boolean>)|null}
 */
function createConfirm(env, { prompt = DEFAULT_PROMPT } = {}) {
  const stdout = env.stdout || process.stdout;
  const stdin = env.stdin || process.stdin;

  if (env.ask) {
    return async () => interpretConfirm(await Promise.resolve(env.ask(prompt)));
  }

  // CI/CI-like environments (CI flag, explicit override) cannot answer an
  // interactive prompt. Return null so callers skip confirmation rather than
  // hanging forever waiting for input that will never arrive.
  if (process.env.IGNOREKIT_NONINTERACTIVE || process.env.CI) return null;

  // An explicitly-passed stdin (tests, piped input) is authoritative: if it
  // does not advertise a TTY, treat it as non-interactive. Falling back to
  // process.stdin.isTTY when stdin.isTTY is undefined can lie about the input
  // source — some test runners don't set isTTY at all and the previous
  // heuristic silently downgraded those to "definitely a TTY".
  const isTTY = !!(stdin && stdin.isTTY);
  if (!isTTY) return null;

  return () => new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(interpretConfirm(answer));
    });
  });
}

module.exports = { createConfirm, interpretConfirm, DEFAULT_PROMPT };
