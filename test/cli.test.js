'use strict';

const assert = require('assert');
const test = require('node:test');
const { runCli } = require('../src/cli');

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
