'use strict';

const readline = require('readline');

const DEFAULT_PROMPT = 'Proceed? [y/N/cancel] (N): ';

/**
 * Decide whether the current invocation can interact with the user.
 *
 * The check is shared between the CLI's prompt helpers so a single set of
 * rules decides "should we open readline?" everywhere:
 *
 *  1. `env.ask` is the highest-priority signal — a test-provided ask function
 *     drives every prompt regardless of stdin.
 *  2. `IGNOREKIT_NONINTERACTIVE` and the standard `CI` flag opt out — a
 *     non-interactive environment cannot answer an interactive prompt, and
 *     hanging forever on readline is worse than refusing to ask.
 *  3. Without an explicit env signal, fall back to `stdin.isTTY`. Real TTYs
 *     can interact; piped / mocked stdin cannot.
 *
 * @param {object} [env] - { stdin, ask }
 * @param {object} [envStdin] - Fallback when env.stdin is absent
 * @returns {boolean}
 */
function isInteractive(env = {}, envStdin) {
  if (env && env.ask) return true;
  if (process.env.IGNOREKIT_NONINTERACTIVE || process.env.CI) return false;
  const stdin = (env && env.stdin) || envStdin;
  return Boolean(stdin && stdin.isTTY);
}

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
 * 3. Piped/non-TTY input or CI/non-interactive environments skip
 *    confirmation entirely (returns null).
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

  if (!isInteractive(env, stdin)) return null;

  return () => new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(interpretConfirm(answer));
    });
  });
}

module.exports = { createConfirm, interpretConfirm, isInteractive, DEFAULT_PROMPT };
