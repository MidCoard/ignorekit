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

  const isTTY = stdin && typeof stdin.isTTY === 'boolean'
    ? stdin.isTTY
    : (typeof process !== 'undefined' && process.stdin && process.stdin.isTTY);
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
