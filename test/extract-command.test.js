'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('extract component writes a reusable component draft', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'logs/\n.env\n');
    const result = await runCli([
      'extract',
      'component',
      'local/runtime',
      '--from',
      workspace.path('project/.gitignore'),
      '--output-root',
      workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const output = fs.readFileSync(workspace.path('defs/components/local/runtime.gitignore'), 'utf8');
    assert.match(output, /logs\//);
    assert.match(output, /\.env/);
  } finally {
    workspace.cleanup();
  }
});

test('extract component rejects invalid ids', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'logs/\n');
    const errors = [];
    const result = await runCli([
      'extract',
      'component',
      '../escape',
      '--from',
      workspace.path('project/.gitignore'),
      '--output-root',
      workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /Invalid definition id/);
  } finally {
    workspace.cleanup();
  }
});
