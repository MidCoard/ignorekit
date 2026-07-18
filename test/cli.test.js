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

// --- #1: collectRepeated must accept --key=value as well as --key value ---

test('init --component=foo --component=bar collects both as repeated values', async () => {
  // The dispatcher collects repeated options by scanning the raw argv with
  // collectRepeated; init, adopt, create component, and create preset all
  // rely on it. Round 2 broke the --key=value form — this test exercises the
  // equals form end-to-end via runCli/init, which is the surface that
  // actually broke for users.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/framework/vite.gitignore', 'dist/\n');
    workspace.writeJson('dist/presets/generic.json', { name: 'generic', components: [] });

    const result = await runCli([
      'init', workspace.path('project'),
      '--preset', 'generic',
      '--component=language/node',
      '--component=framework/vite',
      '--no-git',
      '--dist-root', workspace.path('dist'),
      '--yes'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });
    assert.equal(result.exitCode, 0);
    const cfg = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    assert.ok(cfg.components.includes('language/node'),
      'expected language/node in components');
    assert.ok(cfg.components.includes('framework/vite'),
      'expected framework/vite in components');
  } finally {
    workspace.cleanup();
  }
});

test('adopt --component=foo --component=bar collects both as repeated values', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/framework/vite.gitignore', 'dist/\n');
    workspace.writeJson('dist/presets/empty.json', { name: 'empty', components: [] });
    fs.mkdirSync(workspace.path('project'));

    const result = await runCli([
      'adopt', workspace.path('project'),
      '--preset', 'empty',
      '--component=language/node',
      '--component=framework/vite',
      '--dist-root', workspace.path('dist'),
      '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });
    assert.equal(result.exitCode, 0);
    const cfg = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    assert.deepEqual(cfg.components, ['language/node', 'framework/vite']);
  } finally {
    workspace.cleanup();
  }
});

test('create preset --component=foo --component=bar collects both as repeated values', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', components: [] });

    const result = await runCli([
      'create', 'preset', 'team-stack',
      '--base', 'vite',
      '--component=language/node',
      '--component=framework/vite',
      '--yes',
      '--output-root', workspace.path('defs'),
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });
    assert.equal(result.exitCode, 0);
    const preset = JSON.parse(fs.readFileSync(workspace.path('defs/presets/team-stack.json'), 'utf8'));
    assert.deepEqual(preset.components, ['language/node', 'framework/vite']);
  } finally {
    workspace.cleanup();
  }
});

test('init --exclude=foo --exclude=bar collects both as repeated values', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/platform/macos.gitignore', '.DS_Store\n');
    workspace.writeText('dist/components/platform/windows.gitignore', 'Thumbs.db\n');
    workspace.writeJson('dist/presets/generic.json', { name: 'generic', components: ['platform/macos', 'platform/windows'] });

    const result = await runCli([
      'init', workspace.path('project'),
      '--preset', 'generic',
      '--exclude=platform/macos',
      '--exclude=platform/windows',
      '--no-git',
      '--dist-root', workspace.path('dist'),
      '--yes'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });
    assert.equal(result.exitCode, 0);
    const cfg = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    assert.deepEqual(cfg.exclude, ['platform/macos', 'platform/windows']);
  } finally {
    workspace.cleanup();
  }
});

// --- #13: parseArgs boolean validation rejects inline values + empty key ---

test('parseArgs rejects --yes=false inline value on a boolean flag', () => {
  assert.throws(
    () => parseArgs(['--yes=false']),
    /--yes=false does not take a value/
  );
});

test('parseArgs rejects --git=true inline value on a boolean flag', () => {
  assert.throws(
    () => parseArgs(['--git=true']),
    /--git=true does not take a value/
  );
});

test('parseArgs rejects --=value with empty key', () => {
  assert.throws(
    () => parseArgs(['--=value']),
    /missing a flag name/
  );
});

test('parseArgs still accepts --yes without a value', () => {
  const options = parseArgs(['--yes']);
  assert.equal(options.yes, true);
});

test('parseArgs accepts a value with spaces after --key=', () => {
  // `--key=value with spaces` is one token; the entire suffix after = becomes
  // the value. This is standard POSIX-style behavior.
  const options = parseArgs(['--preset=value with spaces']);
  assert.equal(options.preset, 'value with spaces');
});

// --- #14: applyUserRootDefault must record explicit user intent ---

test('applyUserRootDefault marks _userRootExplicit=true when --user-root was passed', () => {
  const { applyUserRootDefault } = require('../src/core/resolver-factory');
  const options = { userRoot: '/some/where' };
  applyUserRootDefault(options);
  assert.equal(options.userRoot, '/some/where');
  assert.equal(options._userRootExplicit, true);
});

test('applyUserRootDefault marks _userRootExplicit=false when --user-root was omitted', () => {
  const { applyUserRootDefault } = require('../src/core/resolver-factory');
  const options = {};
  applyUserRootDefault(options);
  // The default USER_ROOT path is applied (preserving the historical CLI UX).
  assert.ok(options.userRoot, 'userRoot should be defaulted to USER_ROOT');
  assert.equal(options._userRootExplicit, false);
});

test('create component without --user-root does not emit the discovery-source warning', async () => {
  // Without an explicit --user-root the warning must NOT fire — only the
  // default user definitions layer is in use and the user did not opt into a
  // team-shared discovery directory.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('.gitignore', 'unique-rule-only-this-test/\n');
    const writes = [];
    const result = await runCli([
      'create', 'component', 'explicit-flag-test',
      '--category', 'local',
      '--from', workspace.path('.gitignore'),
      '--yes',
      '--output-root', workspace.path('defs'),
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: text => writes.push(String(text)) },
      cwd: workspace.root
    });
    assert.equal(result.exitCode, 0);
    assert.equal(
      writes.join('').match(/--user-root is a discovery source/g),
      null,
      'discovery-source warning should not fire without explicit --user-root'
    );
  } finally {
    workspace.cleanup();
  }
});

// --- #2: readAllLines handles CRLF input and close-without-end streams ---

test('readAllLines strips CRLF terminators so CRLF and LF inputs match', async () => {
  // readAllLines is module-private; the only public surface that uses it is
  // runWithQuestions in the piped (non-TTY) branch. Drive it through a
  // PassThrough to assert the line-streaming contract.
  const { runWithQuestions } = require('../src/cli');
  const { PassThrough } = require('stream');
  const stdin = new PassThrough();
  stdin.isTTY = false;
  setImmediate(() => {
    stdin.write('first\r\nsecond\r\nthird\r\n');
    stdin.end();
  });
  const answers = [];
  await runWithQuestions(
    { stdin, stdout: { write: () => {} } },
    async ask => {
      answers.push(await ask('1: '));
      answers.push(await ask('2: '));
      answers.push(await ask('3: '));
    }
  );
  assert.deepEqual(answers, ['first', 'second', 'third']);
});

test('readAllLines resolves on stream close when end never fires', async () => {
  // PassThrough with destroy() simulates a parent process that pipes a
  // one-shot answer and never closes stdin cleanly — the original code hung
  // waiting for 'end'.
  const { runWithQuestions } = require('../src/cli');
  const { PassThrough } = require('stream');
  const stdin = new PassThrough();
  stdin.isTTY = false;
  setImmediate(() => {
    stdin.write('only-line\n');
    stdin.destroy();
  });
  const answers = [];
  await runWithQuestions(
    { stdin, stdout: { write: () => {} } },
    async ask => {
      answers.push(await ask('1: '));
    }
  );
  assert.deepEqual(answers, ['only-line']);
});

// --- #3: runWithQuestions returns null under IGNOREKIT_NONINTERACTIVE ---

test('runWithQuestions resolves ask() with null under IGNOREKIT_NONINTERACTIVE', async () => {
  const { runWithQuestions } = require('../src/cli');
  const prev = process.env.IGNOREKIT_NONINTERACTIVE;
  process.env.IGNOREKIT_NONINTERACTIVE = '1';
  try {
    const errors = [];
    let captured;
    await runWithQuestions(
      { stdin: { isTTY: true }, stdout: { write: () => {} }, stderr: { write: t => errors.push(String(t)) } },
      async ask => {
        captured = await ask('Q: ');
      }
    );
    assert.equal(captured, null, 'ask() should resolve with null under non-interactive mode');
    assert.match(errors.join(''), /Interactive prompt skipped/);
  } finally {
    if (prev === undefined) delete process.env.IGNOREKIT_NONINTERACTIVE;
    else process.env.IGNOREKIT_NONINTERACTIVE = prev;
  }
});

test('runWithQuestions resolves ask() with null under CI even with TTY-like stdin', async () => {
  const { runWithQuestions } = require('../src/cli');
  const prev = process.env.CI;
  process.env.CI = '1';
  try {
    let captured;
    await runWithQuestions(
      { stdin: { isTTY: true }, stdout: { write: () => {} }, stderr: { write: () => {} } },
      async ask => {
        captured = await ask('Q: ');
      }
    );
    assert.equal(captured, null, 'ask() should resolve with null under CI');
  } finally {
    if (prev === undefined) delete process.env.CI; else process.env.CI = prev;
  }
});

test('env.ask is honored under IGNOREKIT_NONINTERACTIVE', async () => {
  // When a test harness (or a parent process) provides env.ask explicitly,
  // it drives every prompt regardless of the non-interactive env flag.
  const { runWithQuestions } = require('../src/cli');
  const prev = process.env.IGNOREKIT_NONINTERACTIVE;
  process.env.IGNOREKIT_NONINTERACTIVE = '1';
  try {
    const answers = [];
    await runWithQuestions(
      { stdin: { isTTY: true }, stdout: { write: () => {} }, stderr: { write: () => {} },
        ask: async () => 'canned' },
      async ask => {
        answers.push(await ask('Q: '));
        answers.push(await ask('Q2: '));
      }
    );
    assert.deepEqual(answers, ['canned', 'canned']);
  } finally {
    if (prev === undefined) delete process.env.IGNOREKIT_NONINTERACTIVE;
    else process.env.IGNOREKIT_NONINTERACTIVE = prev;
  }
});

// --- #4: pickPresetInteractive availability-checked shortcuts ---

test('pickPresetInteractive omits "b. blank" when blank preset is absent', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/alpha.json', { name: 'alpha', components: [] });
    workspace.writeJson('dist/presets/zeta.json', { name: 'zeta', components: [] });

    const { pickPresetInteractive } = require('../src/cli');
    const writes = [];
    const result = await pickPresetInteractive(
      { distRoot: workspace.path('dist') },
      {
        stdout: { write: text => writes.push(String(text)) },
        stdin: { isTTY: true },
        ask: async () => ''
      }
    );
    assert.equal(result, null);
    assert.equal(writes.join('').match(/b\. blank/g), null,
      'should not advertise a blank shortcut when blank preset is absent');
  } finally {
    workspace.cleanup();
  }
});

test('pickPresetInteractive omits "g. generic" when generic preset is absent', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/alpha.json', { name: 'alpha', components: [] });
    workspace.writeJson('dist/presets/blank.json', { name: 'blank', components: [] });

    const { pickPresetInteractive } = require('../src/cli');
    const writes = [];
    await pickPresetInteractive(
      { distRoot: workspace.path('dist') },
      {
        stdout: { write: text => writes.push(String(text)) },
        stdin: { isTTY: true },
        ask: async () => ''
      }
    );
    assert.equal(writes.join('').match(/g\. generic/g), null,
      'should not advertise a generic shortcut when generic preset is absent');
  } finally {
    workspace.cleanup();
  }
});

test('pickPresetInteractive rejects "b" shortcut when blank preset is absent', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/alpha.json', { name: 'alpha', components: [] });

    const { pickPresetInteractive } = require('../src/cli');
    const writes = [];
    const result = await pickPresetInteractive(
      { distRoot: workspace.path('dist') },
      {
        stdout: { write: text => writes.push(String(text)) },
        stdin: { isTTY: true },
        ask: async () => 'b'
      }
    );
    assert.equal(result, null);
    assert.match(writes.join(''), /'blank' preset is not available/);
  } finally {
    workspace.cleanup();
  }
});

// --- #17: picker stderr message under non-interactive mode ---

test('init --preset-less under IGNOREKIT_NONINTERACTIVE prints stderr guidance and exits 1', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/alpha.json', { name: 'alpha', components: [] });

    const prev = process.env.IGNOREKIT_NONINTERACTIVE;
    process.env.IGNOREKIT_NONINTERACTIVE = '1';
    const errors = [];
    try {
      const result = await runCli([
        'init', workspace.path('project'),
        '--no-git',
        '--dist-root', workspace.path('dist'),
        '--yes'
      ], {
        stdout: { write: () => {} },
        stderr: { write: text => errors.push(String(text)) },
        stdin: { isTTY: false },
        cwd: workspace.root
      });
      assert.equal(result.exitCode, 1);
      assert.match(errors.join(''), /No default preset available/);
    } finally {
      if (prev === undefined) delete process.env.IGNOREKIT_NONINTERACTIVE;
      else process.env.IGNOREKIT_NONINTERACTIVE = prev;
    }
  } finally {
    workspace.cleanup();
  }
});

// --- #5: parseSignificantLines keepRaw returns {original} only ---

test('parseSignificantLines with keepRaw returns {original} entries', () => {
  const { parseSignificantLines } = require('../src/core/text');
  const lines = parseSignificantLines('cache/\n  trailing-space   \n\\#literal\n', { keepRaw: true });
  assert.deepEqual(lines, [
    { original: 'cache/' },
    { original: '  trailing-space   ' },
    { original: '\\#literal' }
  ]);
});

test('parseSignificantLines without keepRaw returns strings (unchanged)', () => {
  const { parseSignificantLines } = require('../src/core/text');
  const lines = parseSignificantLines('cache/\n# comment\n\nsecret\n');
  assert.deepEqual(lines, ['cache/', 'secret']);
});

// --- #4 (P1): pickPresetInteractive must receive env.ask from init/adopt ---

test('init without --preset passes env.ask through to pickPresetInteractive', async () => {
  const workspace = createTempWorkspace();
  try {
    // No 'generic' preset — without env.ask the picker has no safe default and
    // returns null (exit 1). With env.ask passed through, the test-provided
    // ask function drives the picker and returns 'alpha' (exit 0).
    workspace.writeJson('dist/presets/alpha.json', { name: 'alpha', components: [] });

    let askCalledWith = null;
    const result = await runCli([
      'init', workspace.path('project'),
      '--no-git',
      '--dist-root', workspace.path('dist'),
      '--yes'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root,
      ask: async (prompt) => {
        askCalledWith = prompt;
        return 'alpha';
      }
    });

    // If env.ask was correctly passed through, the picker uses it and returns
    // 'alpha'. Without the fix, ask is never called and the picker returns null.
    assert.ok(askCalledWith !== null, 'env.ask should have been called by pickPresetInteractive');
    assert.match(askCalledWith, /Pick a preset/);
    assert.equal(result.exitCode, 0, 'init should succeed when ask drives the picker');
  } finally {
    workspace.cleanup();
  }
});

test('adopt without --preset passes env.ask through to pickPresetInteractive', async () => {
  const workspace = createTempWorkspace();
  try {
    // No 'generic' preset — same reasoning as the init test above.
    workspace.writeJson('dist/presets/alpha.json', { name: 'alpha', components: [] });
    fs.mkdirSync(workspace.path('project'));

    let pickerAskCalled = false;
    // The adopt flow asks two questions: the preset picker and then the confirm.
    // Return 'alpha' for the picker, 'y' for the confirm.
    const answers = ['alpha', 'y'];
    const result = await runCli([
      'adopt', workspace.path('project'),
      '--dist-root', workspace.path('dist'),
      '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root,
      ask: async (prompt) => {
        if (/Pick a preset/.test(prompt)) pickerAskCalled = true;
        return answers.shift() || '';
      }
    });

    assert.ok(pickerAskCalled, 'env.ask should have been called by pickPresetInteractive');
    assert.equal(result.exitCode, 0, 'adopt should succeed when ask drives the picker');
  } finally {
    workspace.cleanup();
  }
});

// --- #1 (Round 6): pickPresetInteractive must receive env.cwd from init/adopt ---

test('init without --preset passes env.cwd to pickPresetInteractive for .gitignore detection', async () => {
  // When the project directory contains a .gitignore, pickPresetInteractive
  // tries to analyze it for preset suggestions. The picker resolves
  // options.projectPath relative to env.cwd. Without env.cwd in the picker
  // env, the path resolution falls back to process.cwd() and the .gitignore
  // is never found — the user sees no suggestion. With env.cwd passed through,
  // the picker resolves the project path relative to the test-provided cwd
  // and finds the .gitignore.
  //
  // Use a RELATIVE project path so that path.resolve(env.cwd, path) actually
  // depends on env.cwd. An absolute path would bypass cwd entirely.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Place a .gitignore in the project directory so the picker can detect it
    workspace.writeText('project/.gitignore', 'logs/\n');

    const output = [];
    const result = await runCli([
      'init', 'project',
      '--no-git',
      '--dist-root', workspace.path('dist'),
      '--overwrite',
      '--yes'
    ], {
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root,
      ask: async () => 'demo'
    });

    assert.equal(result.exitCode, 0, 'init should succeed when cwd is passed to picker');
    // The picker should have found the .gitignore and printed the analysis header.
    // Without env.cwd, the .gitignore is not found and "Found .gitignore" never appears.
    assert.match(output.join(''), /Found .gitignore/,
      'picker should detect .gitignore when env.cwd is passed through');
  } finally {
    workspace.cleanup();
  }
});

test('adopt without --preset passes env.cwd to pickPresetInteractive for .gitignore detection', async () => {
  // Same as the init test above but for the adopt command. Uses a relative
  // project path so env.cwd is required for correct path resolution.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'logs/\n');

    const output = [];
    const answers = ['demo', 'y'];
    const result = await runCli([
      'adopt', 'project',
      '--dist-root', workspace.path('dist'),
      '--apply'
    ], {
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root,
      ask: async () => answers.shift() || ''
    });

    assert.equal(result.exitCode, 0, 'adopt should succeed when cwd is passed to picker');
    assert.match(output.join(''), /Found .gitignore/,
      'picker should detect .gitignore when env.cwd is passed through');
  } finally {
    workspace.cleanup();
  }
});

// --- #3 (P0): create command interactive env must include stderr ---

test('create component interactive flow routes stderr through env.stderr', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'custom-rule-only-this-test/\n');
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    const stderrWrites = [];
    const answers = [
      'local',                         // category
      'stderr-routing-test',           // name
      workspace.path('project/.gitignore'), // source
      '',                              // toggle rules — done
      'y'                              // confirm
    ];

    const result = await runCli([
      'create', 'component',
      '--user-root', fakeUserRoot,
      '--output-root', fakeUserRoot
    ], {
      ask: () => answers.shift(),
      stdout: { write: () => {} },
      stderr: { write: text => stderrWrites.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0, `expected exit 0; stderr: ${stderrWrites.join('')}`);
    // The key assertion: the component was created successfully with the test
    // stderr stream. Without the fix, the inner env passed to
    // promptComponentCreation lacks stderr, so chooseRulesSmart's
    // analyzeGitignore call and fallback error messages would bypass the
    // test-provided stderr and write to process.stderr instead.
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'stderr-routing-test.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
  } finally {
    workspace.cleanup();
  }
});

test('create component interactive flow passes stderr to chooseRulesSmart', async () => {
  // This test specifically exercises the stderr routing through the
  // create-component interactive path. When the source .gitignore triggers
  // a fallback (e.g. oversized file), chooseRulesSmart writes to env.stderr.
  // Without the fix, the inner env object at cli.js:646-648 lacks stderr,
  // so the fallback message goes to process.stderr instead of the test stream.
  const workspace = createTempWorkspace();
  try {
    const hugePath = workspace.path('project/huge.gitignore');
    fs.mkdirSync(path.dirname(hugePath), { recursive: true });
    const padding = '\n'.repeat(2 * 1024 * 1024);
    fs.writeFileSync(hugePath, 'real-rule-A\nreal-rule-B\n' + padding, 'utf8');

    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    const stderrWrites = [];
    const answers = [
      'local',                         // category
      'stderr-fallback-test',          // name
      hugePath,                        // source — large file triggers fallback
      'inline-rule',                   // inline rule (fallback path)
      '',                              // blank → done
      'y'                              // confirm
    ];

    const result = await runCli([
      'create', 'component',
      '--user-root', fakeUserRoot,
      '--output-root', fakeUserRoot
    ], {
      ask: () => answers.shift(),
      stdout: { write: () => {} },
      stderr: { write: text => stderrWrites.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0, `expected exit 0; stderr: ${stderrWrites.join('')}`);
    // The fallback message from chooseRulesSmart should appear in the
    // test-provided stderr, not on process.stderr.
    const stderrText = stderrWrites.join('');
    assert.match(stderrText, /Could not analyze|Falling back/,
      'chooseRulesSmart fallback message should appear in env.stderr');
  } finally {
    workspace.cleanup();
  }
});

// --- #2 (P1): create command runWithQuestions must receive constructed env, not raw env ---

test('create component interactive flow passes env.ask to runWithQuestions', async () => {
  // The create command's interactive path called runWithQuestions(env, ...) with
  // the raw env from runCli. The fix routes a properly constructed env (with
  // stdout, stderr, cwd, stdin, ask) to runWithQuestions, matching the pattern
  // used by buildPickerEnv for init/adopt. This test verifies that env.ask
  // reaches runWithQuestions in the create component path.
  const workspace = createTempWorkspace();
  try {
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    let askCalled = false;
    const answers = [
      'local',                         // category
      'ask-routing-test',              // name
      '',                              // source .gitignore (empty = skip)
      'my-rule',                       // inline rule
      '',                              // end inline rules
    ];

    const result = await runCli([
      'create', 'component',
      '--user-root', fakeUserRoot,
      '--output-root', fakeUserRoot,
      '--dist-root', workspace.path('dist'),
      '--yes'
    ], {
      ask: async (prompt) => {
        askCalled = true;
        return answers.shift() || '';
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.ok(askCalled, 'env.ask should be called by runWithQuestions in create component path');
    assert.equal(result.exitCode, 0, 'create component should succeed with env.ask');
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'ask-routing-test.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
  } finally {
    workspace.cleanup();
  }
});

test('create preset interactive flow passes env.ask to runWithQuestions', async () => {
  // Same as above but for the preset subcommand.
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/base.json', { name: 'base', components: [] });
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    let askCalled = false;
    const answers = [
      'ask-preset-test',               // name
      '0',                             // base preset (0 = no base)
      '',                              // no components
    ];

    const result = await runCli([
      'create', 'preset',
      '--user-root', fakeUserRoot,
      '--output-root', fakeUserRoot,
      '--dist-root', workspace.path('dist'),
      '--yes'
    ], {
      ask: async (prompt) => {
        askCalled = true;
        return answers.shift() || '';
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.ok(askCalled, 'env.ask should be called by runWithQuestions in create preset path');
    assert.equal(result.exitCode, 0, 'create preset should succeed with env.ask');
    const presetFile = path.join(fakeUserRoot, 'presets', 'ask-preset-test.json');
    assert.ok(fs.existsSync(presetFile), `Expected file at ${presetFile}`);
  } finally {
    workspace.cleanup();
  }
});

test('create component interactive flow uses constructed env stdin for runWithQuestions', async () => {
  // When env.ask is NOT provided, runWithQuestions falls back to stdin-based
  // input. The fix ensures the constructed env (with stdin) is passed to
  // runWithQuestions rather than the raw env, so piped stdin works correctly.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    const { PassThrough } = require('stream');
    const stdin = new PassThrough();
    stdin.isTTY = false;

    // Feed answers for the interactive component creation:
    // category, name, source .gitignore (empty = skip), rule, blank-to-end
    setImmediate(() => {
      stdin.write('local\n');
      stdin.write('piped-input-test\n');
      stdin.write('\n');   // no source file
      stdin.write('my-rule\n');
      stdin.write('\n');   // end inline rules
      stdin.end();
    });

    const result = await runCli([
      'create', 'component',
      '--user-root', fakeUserRoot,
      '--output-root', fakeUserRoot,
      '--dist-root', workspace.path('dist')
    ], {
      stdin,
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0, 'create component should succeed with piped stdin');
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'piped-input-test.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
  } finally {
    workspace.cleanup();
  }
});
