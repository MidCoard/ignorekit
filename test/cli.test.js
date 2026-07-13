'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const test = require('node:test');
const path = require('path');
const { runCli, parseArgs } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

function createListFixture() {
  const workspace = createTempWorkspace();
  workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
  workspace.writeJson('dist/presets/node.json', { name: 'node', components: ['language/node'] });
  return workspace;
}

// --- Help ---

test('help prints the command list', async () => {
  const writes = [];
  const result = await runCli(['help'], {
    stdout: { write: (text) => writes.push(String(text)) },
    stderr: { write: () => {} },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 0);
  const output = writes.join('');
  assert.match(output, /ignorekit/);
  assert.match(output, /generate/);
  assert.match(output, /init/);
  assert.match(output, /adopt/);
  assert.match(output, /create/);
  assert.match(output, /list/);
});

test('help <command> prints detailed help', async () => {
  const writes = [];
  const result = await runCli(['help', 'init'], {
    stdout: { write: (text) => writes.push(String(text)) },
    stderr: { write: () => {} },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 0);
  const output = writes.join('');
  assert.match(output, /--preset/);
  assert.match(output, /--git/);
  assert.match(output, /--no-git/);
});

test('help create describes interactive component and preset creation', async () => {
  const writes = [];
  const result = await runCli(['help', 'create'], {
    stdout: { write: text => writes.push(String(text)) },
    stderr: { write: () => {} },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 0);
  const output = writes.join('');
  assert.match(output, /create component/);
  assert.match(output, /--category/);
  assert.match(output, /create preset/);
});

test('help for unknown command falls back to general help', async () => {
  const writes = [];
  const result = await runCli(['help', 'nonexistent'], {
    stdout: { write: (text) => writes.push(String(text)) },
    stderr: { write: () => {} },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 0);
  const output = writes.join('');
  assert.match(output, /No help available/);
});

test('unknown command returns exit code 1', async () => {
  const errors = [];
  const result = await runCli(['unknown-command'], {
    stdout: { write: () => {} },
    stderr: { write: (text) => errors.push(String(text)) },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 1);
  assert.match(errors.join(''), /Unknown command/);
});

// --- List ---

test('list shows components and presets', async () => {
  const workspace = createListFixture();
  try {
    const writes = [];
    const result = await runCli(['list', '--dist-root', workspace.path('dist')], {
      stdout: { write: (text) => writes.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const output = writes.join('');
    assert.match(output, /Components:/);
    assert.match(output, /language\/node/);
    assert.match(output, /Presets:/);
    assert.match(output, /node/);
  } finally {
    workspace.cleanup();
  }
});

test('list components shows only components', async () => {
  const workspace = createListFixture();
  try {
    const writes = [];
    const result = await runCli(['list', 'components', '--dist-root', workspace.path('dist')], {
      stdout: { write: (text) => writes.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const output = writes.join('');
    assert.match(output, /language\/node/);
    assert.doesNotMatch(output, /Presets:/);
  } finally {
    workspace.cleanup();
  }
});

test('list includes configured user definitions', async () => {
  const workspace = createListFixture();
  try {
    workspace.writeText('user/components/local/personal.gitignore', 'personal/\n');
    workspace.writeJson('user/presets/personal.json', { name: 'personal', components: [] });

    const writes = [];
    const result = await runCli([
      'list', '--dist-root', workspace.path('dist'), '--user-root', workspace.path('user')
    ], {
      stdout: { write: (text) => writes.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const output = writes.join('');
    assert.match(output, /local\/personal/);
    assert.match(output, /personal/);
  } finally {
    workspace.cleanup();
  }
});

test('list rejects unknown targets', async () => {
  const errors = [];
  const result = await runCli(['list', 'invalid'], {
    stdout: { write: () => {} },
    stderr: { write: (text) => errors.push(String(text)) },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 1);
  assert.match(errors.join(''), /Unknown list target/);
});

// --- User layer default (dist CLI UX) ---

test('list surfaces personal definitions from USER_ROOT when no --user-root is passed', async () => {
  const workspace = createListFixture();
  const { USER_ROOT } = require('../src/core/path');
  const componentId = `local/cli-default-${process.pid}`;
  const componentPath = path.join(USER_ROOT, 'components', `${componentId}.gitignore`);
  try {
    fs.mkdirSync(path.dirname(componentPath), { recursive: true });
    fs.writeFileSync(componentPath, 'personal/\n', 'utf8');

    const writes = [];
    const result = await runCli(['list', 'components', '--dist-root', workspace.path('dist')], {
      stdout: { write: (text) => writes.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    // The CLI defaults the opt-in user layer to ~/.ignorekit, preserving the
    // "personal definitions apply everywhere" behavior.
    assert.match(writes.join(''), new RegExp(componentId.replace(/\//g, '\\/')));
  } finally {
    fs.rmSync(componentPath, { force: true });
    workspace.cleanup();
  }
});

// --- Wrapper error handling ---

test('wrapper reports rejected runCli errors without stack traces', () => {
  const workspace = createTempWorkspace();
  try {
    const wrapperPath = path.join(__dirname, '..', 'bin', 'ignorekit.js');
    workspace.writeText('bin/ignorekit.js', fs.readFileSync(wrapperPath, 'utf8'));
    workspace.writeText('src/cli.js', `'use strict';

async function runCli() {
  throw new Error('boom');
}

module.exports = { runCli };
`);

    const result = childProcess.spawnSync(process.execPath, [workspace.path('bin', 'ignorekit.js')], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'ignorekit: boom\n');
  } finally {
    workspace.cleanup();
  }
});

// --- parseArgs --key=value syntax ---

test('parseArgs supports --key=value syntax for value options', () => {
  const options = parseArgs(['--preset=vite', '--output-root=somewhere']);
  assert.equal(options.preset, 'vite');
  assert.equal(options.outputRoot, 'somewhere');
});

test('parseArgs supports mixed --key value and --key=value forms', () => {
  const options = parseArgs(['--preset', 'java', '--dist-root=here']);
  assert.equal(options.preset, 'java');
  assert.equal(options.distRoot, 'here');
});

test('parseArgs still recognises space-separated values', () => {
  const options = parseArgs(['--preset', 'vite']);
  assert.equal(options.preset, 'vite');
});

// --- pickPresetInteractive default fallback (no suggestion, no generic) ---

test('pickPresetInteractive does not silently default to alphabet[0] when no suggestion or generic', async () => {
  const workspace = createTempWorkspace();
  try {
    // Two presets: 'apple' and 'banana'. No 'generic' preset exists. alphabet[0]
    // would be 'apple', but the picker should NOT silently pick it; an empty
    // answer with no safe default must surface that to the caller.
    workspace.writeJson('dist/presets/apple.json', { name: 'apple', components: [] });
    workspace.writeJson('dist/presets/banana.json', { name: 'banana', components: [] });

    const { pickPresetInteractive } = require('../src/cli');
    const result = await pickPresetInteractive(
      { distRoot: workspace.path('dist') },
      {
        stdout: { write: () => {} },
        stdin: { isTTY: true },
        ask: async () => ''
      }
    );

    assert.equal(result, null,
      `expected null when no safe default exists and user entered empty, got ${result}`);
  } finally {
    workspace.cleanup();
  }
});

test('pickPresetInteractive returns null when no default exists and user enters empty twice', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/alpha.json', { name: 'alpha', components: [] });
    workspace.writeJson('dist/presets/zeta.json', { name: 'zeta', components: [] });

    const { pickPresetInteractive } = require('../src/cli');
    const result = await pickPresetInteractive(
      { distRoot: workspace.path('dist') },
      {
        stdout: { write: () => {} },
        stdin: { isTTY: true },
        ask: async () => ''
      }
    );

    assert.equal(result, null,
      `expected null when no safe default exists and user declined to pick, got ${result}`);
  } finally {
    workspace.cleanup();
  }
});

// --- runWithQuestions: piped input must not drop lines ---

test('runWithQuestions delivers every queued line to a sequential ask() call', async () => {
  const { runWithQuestions } = require('../src/cli');
  // Fake stdin with the three queued lines already buffered. readline would
  // emit 'line' for each, which the queueing helper must preserve even when
  // ask() is called sequentially (the original code dropped lines under load).
  const { PassThrough } = require('stream');
  const stdin = new PassThrough();
  stdin.isTTY = false;
  setImmediate(() => {
    stdin.write('first\n');
    stdin.write('second\n');
    stdin.write('third\n');
    stdin.end();
  });
  const answers = [];
  const result = await runWithQuestions(
    { stdin, stdout: { write: () => {} } },
    async ask => {
      answers.push(await ask('1: '));
      answers.push(await ask('2: '));
      answers.push(await ask('3: '));
      return answers.join('|');
    }
  );
  assert.deepEqual(answers, ['first', 'second', 'third'],
    `expected 3 sequential answers, got ${JSON.stringify(answers)}`);
  assert.equal(result, 'first|second|third');
});

test('runWithQuestions drains all piped lines before each ask() resolves', async () => {
  const { runWithQuestions } = require('../src/cli');
  // Five lines queued; the bug under fix #6 caused lines past the third ask
  // to be silently dropped when stdin was piped without env.ask. Drive ask()
  // four times and confirm we get four distinct values from the queue, with
  // an empty string as the deferred answer when the queue runs out.
  const { PassThrough } = require('stream');
  const stdin = new PassThrough();
  stdin.isTTY = false;
  const linesWritten = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  setImmediate(() => {
    for (const line of linesWritten) stdin.write(`${line}\n`);
    stdin.end();
  });
  const answers = [];
  await runWithQuestions(
    { stdin, stdout: { write: () => {} } },
    async ask => {
      answers.push(await ask('1: '));
      answers.push(await ask('2: '));
      answers.push(await ask('3: '));
      answers.push(await ask('4: '));
      answers.push(await ask('5: '));
    }
  );
  assert.deepEqual(answers, linesWritten,
    `expected all 5 piped lines to be delivered in order, got ${JSON.stringify(answers)}`);
});

// --- #8 (Adv): CI/IGNOREKIT_NONINTERACTIVE env must skip confirmation ---

test('createConfirm returns null under CI even when stdin reports TTY', async () => {
  const { createConfirm } = require('../src/cli/prompt');
  const prev = {
    ci: process.env.CI,
    noninteractive: process.env.IGNOREKIT_NONINTERACTIVE
  };
  process.env.CI = '1';
  delete process.env.IGNOREKIT_NONINTERACTIVE;
  try {
    // Pass a fake "TTY" stdin — without the env guard, the confirm prompt
    // would try to readline on it and hang or read garbage.
    const fakeStdin = { isTTY: true, on: () => {}, setEncoding: () => {} };
    const confirm = createConfirm({
      stdout: { write: () => {} },
      stdin: fakeStdin
    });
    assert.equal(confirm, null,
      'expected createConfirm to bail out under CI without env.ask');
  } finally {
    if (prev.ci === undefined) delete process.env.CI; else process.env.CI = prev.ci;
    if (prev.noninteractive === undefined) delete process.env.IGNOREKIT_NONINTERACTIVE;
    else process.env.IGNOREKIT_NONINTERACTIVE = prev.noninteractive;
  }
});

test('createConfirm returns null under IGNOREKIT_NONINTERACTIVE', async () => {
  const { createConfirm } = require('../src/cli/prompt');
  const prev = process.env.IGNOREKIT_NONINTERACTIVE;
  process.env.IGNOREKIT_NONINTERACTIVE = '1';
  try {
    const fakeStdin = { isTTY: true };
    const confirm = createConfirm({
      stdout: { write: () => {} },
      stdin: fakeStdin
    });
    assert.equal(confirm, null,
      'expected createConfirm to bail out under IGNOREKIT_NONINTERACTIVE');
  } finally {
    if (prev === undefined) delete process.env.IGNOREKIT_NONINTERACTIVE;
    else process.env.IGNOREKIT_NONINTERACTIVE = prev;
  }
});
