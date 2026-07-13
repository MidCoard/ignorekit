'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const test = require('node:test');
const path = require('path');
const { runCli } = require('../src/cli');
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
