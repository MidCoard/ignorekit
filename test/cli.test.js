'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const test = require('node:test');
const path = require('path');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('help prints the implemented command groups', async () => {
  const writes = [];
  const result = await runCli(['help'], {
    stdout: { write: (text) => writes.push(String(text)) },
    stderr: { write: () => {} },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 0);
  const output = writes.join('');
  assert.match(output, /ignorekit/);
  assert.match(output, /generate <config>/);
  assert.match(output, /init <project-path>/);
  assert.match(output, /adopt <project-path>/);
  assert.match(output, /extract component <id>/);
  assert.match(output, /preset create <name>/);
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
