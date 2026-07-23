'use strict';

const readline = require('readline');

const DEFAULT_PROMPT = 'Proceed? [Y/n] ';

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
 * Empty input uses the prompt's configured default. An explicit 'n' or 'no'
 * declines, and an explicit 'y' or 'yes' proceeds.
 *
 * @param {string} answer
 * @returns {boolean}
 */
function interpretConfirm(answer, defaultValue = true) {
  const v = String(answer == null ? '' : answer).trim().toLowerCase();
  if (v === '') return defaultValue;
  if (v === 'n' || v === 'no') return false;
  // Any other input follows the prompt's configured default.
  if (v === 'y' || v === 'yes') return true;
  return defaultValue;
}

/**
 * Build a confirm() callback for a workflow env, or return null when no prompt
 * should be shown (non-interactive input).
 *
 * Precedence (highest to lowest), kept in lock-step with `runWithQuestions`
 * in src/cli.js so a single rule decides "should we open readline?" across
 * the whole CLI:
 *   1. `env.ask` — drives every prompt via the supplied ask function. This
 *      is the only signal honored under IGNOREKIT_NONINTERACTIVE / CI, so
 *      tests can exercise prompt paths in any environment.
 *   2. `isInteractive()` — checks `IGNOREKIT_NONINTERACTIVE` / `CI` and
 *      `stdin.isTTY`. False → return null (the workflow handles the no-confirm
 *      case by either skipping the prompt or refusing to proceed).
 *   3. Real TTY — opens readline and asks the user.
 *
 * Note: when a test sets `env.ask` AND `CI=1`, `env.ask` wins. That's the
 * intended contract; tests deliberately bypass CI to exercise the prompt path.
 *
 * @param {object} env - { stdout, stdin, ask }
 * @param {object} [opts]
 * @param {string} [opts.prompt] - Prompt text
 * @param {boolean} [opts.defaultValue=true] - Result for an empty answer
 * @returns {(() => Promise<boolean>)|null}
 */
function createConfirm(env, { prompt = DEFAULT_PROMPT, defaultValue = true } = {}) {
  const stdout = env.stdout || process.stdout;
  const stdin = env.stdin || process.stdin;

  // env.ask short-circuits BEFORE isInteractive() — by design, so a test can
  // drive the prompt under CI without rewriting the prompt logic.
  if (env.ask) {
    return async (overridePrompt) => interpretConfirm(await Promise.resolve(env.ask(overridePrompt || prompt)), defaultValue);
  }

  if (!isInteractive(env, stdin)) return null;

  return (overridePrompt) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(overridePrompt || prompt, (answer) => {
      rl.close();
      resolve(interpretConfirm(answer, defaultValue));
    });
  });
}

/**
 * Build an ask() callback for a workflow env, or return null when no prompt
 * should be shown (non-interactive input). Works like createConfirm but returns
 * the raw string answer instead of interpreting it as a boolean.
 *
 * This is used by workflows that need to ask yes/no questions beyond the main
 * confirm gate (e.g. "Overwrite config?", "Show preview?"). The ask function
 * lets the workflow interpret the answer in its own context.
 *
 * @param {object} env - { stdout, stdin, ask }
 * @returns {((prompt?: string) => Promise<string>)|null}
 */
function createAsk(env) {
  const stdout = env.stdout || process.stdout;
  const stdin = env.stdin || process.stdin;

  // env.ask short-circuits BEFORE isInteractive() — same as createConfirm.
  if (env.ask) {
    return (prompt) => Promise.resolve(env.ask(prompt));
  }

  if (!isInteractive(env, stdin)) return null;

  return (prompt) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

module.exports = { createAsk, createConfirm, interpretConfirm, isInteractive, runWithQuestions, readAllLines, DEFAULT_PROMPT };

/**
 * Drive an interactive question/answer flow.
 *
 * Precedence (highest to lowest) — any higher-priority signal short-circuits
 * the lower ones:
 *   1. `env.ask` — a test or parent-supplied ask function drives every
 *      prompt synchronously. This is the only signal honored under
 *      IGNOREKIT_NONINTERACTIVE / CI, so tests can exercise prompt paths
 *      regardless of CI mode.
 *   2. `IGNOREKIT_NONINTERACTIVE` / `CI` — refuse to open readline at all;
 *      every ask() resolves with null and the caller decides what to do.
 *   3. `stdin.isTTY === false` (piped input) — drain the stream into a
 *      line buffer and serve the buffered lines one-per-ask.
 *   4. Real TTY — full readline interaction with queued-line buffering.
 *
 * @param {object} env - { stdin, stdout, stderr, ask }
 * @param {(ask: (prompt: string) => Promise<string|null>) => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function runWithQuestions(env, operation) {
  if (env.ask) {
    return operation(prompt => Promise.resolve(env.ask(prompt)));
  }

  const stdin = env.stdin || process.stdin;
  const stdout = env.stdout || process.stdout;
  const stderr = env.stderr || process.stderr;

  // CI / IGNOREKIT_NONINTERACTIVE cannot answer an interactive prompt at all.
  // Returning a no-op ask() that resolves with null signals "we gave up" —
  // callers (e.g. the preset picker) translate null into a stderr message
  // and exit non-zero rather than hanging forever.
  if (process.env.IGNOREKIT_NONINTERACTIVE || process.env.CI) {
    const reason = process.env.IGNOREKIT_NONINTERACTIVE ? 'IGNOREKIT_NONINTERACTIVE' : 'CI';
    stderr.write(`Interactive prompt skipped (${reason} set).\n`);
    function noop() {
      return Promise.resolve(null);
    }
    return operation(noop);
  }

  // Piped (non-TTY) input: drain the entire stream into a buffer first so we
  // can serve the buffered lines one-per-ask without racing readline's async
  // delivery. Without this, line events can land in queuedLines out of order
  // with pendingQuestions resolution and silently drop the lines that arrive
  // after ask() is called but before the next event loop tick.
  if (!stdin || stdin.isTTY === false || stdin.isTTY === undefined) {
    const lines = await readAllLines(stdin);
    let cursor = 0;
    function ask(prompt) {
      stdout.write(prompt);
      if (cursor < lines.length) return Promise.resolve(lines[cursor++]);
      // Past the drained stream: blank answers. The operation decides what an
      // empty response means in its own context (interpret as "no", or fall
      // through to a default).
      return Promise.resolve('');
    }
    return operation(ask);
  }

  // TTY: real readline interaction. Each ask() waits for one line; queued
  // lines from input already buffered are served first.
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const queuedLines = [];
  const pendingQuestions = [];
  let closed = false;

  rl.on('line', line => {
    const pending = pendingQuestions.shift();
    if (pending) pending(line);
    else queuedLines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (pendingQuestions.length > 0) pendingQuestions.shift()('');
  });

  function ask(prompt) {
    stdout.write(prompt);
    if (queuedLines.length > 0) return Promise.resolve(queuedLines.shift());
    if (closed) return Promise.resolve('');
    return new Promise(resolve => pendingQuestions.push(resolve));
  }

  try {
    return await operation(ask);
  } finally {
    rl.close();
  }
}

/**
 * Read every line from a (non-TTY) stream into an array.
 *
 * Two failure modes the original implementation missed:
 *
 *  - Some streams (PassThrough in tests, parent processes that pipe one-shot
 *    answers) emit 'close' without ever firing 'end'. Listening only to 'end'
 *    leaves the promise pending forever; also listen to 'close' and resolve
 *    with whatever was buffered.
 *  - Caller-owned streams that are paused will not deliver data until resumed.
 *    Calling `stream.resume()` here is safe for already-flowing streams
 *    (resume() is a no-op when the stream is not paused) and unblocks paused
 *    streams that were passed in by a test harness.
 *
 *  Lines are stripped of trailing `\r` so CRLF input (`a\r\nb\r\n`) is treated
 *  identically to LF input (`a\nb\n`).
 *
 * @param {NodeJS.ReadableStream} stream
 * @returns {Promise<string[]>}
 */
function readAllLines(stream) {
  return new Promise((resolve, reject) => {
    if (!stream || typeof stream.on !== 'function') {
      resolve([]);
      return;
    }
    const lines = [];
    let buf = '';
    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      if (buf.length > 0) lines.push(buf.replace(/\r+$/, ''));
      resolve(lines);
    }
    stream.setEncoding('utf8');
    if (typeof stream.resume === 'function') stream.resume();
    stream.on('data', chunk => {
      buf += chunk;
      const parts = buf.split('\n');
      // Keep the tail (after the last \n) in the buffer for the next chunk;
      // push every completed line immediately, stripping terminal \r so CRLF
      // and LF input produce identical output.
      buf = parts.pop();
      for (const line of parts) lines.push(line.replace(/\r+$/, ''));
    });
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', err => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}
