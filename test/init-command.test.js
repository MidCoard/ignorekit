'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('init creates config and gitignore without forcing git init when --no-git is used', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });

    const result = await runCli([
      'init',
      workspace.path('project'),
      '--preset',
      'demo',
      '--no-git',
      '--dist-root',
      workspace.path('dist'),
      '--yes'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), true);
    assert.equal(fs.existsSync(workspace.path('project/.gitignore')), true);
    assert.equal(fs.existsSync(workspace.path('project/.git')), false);
  } finally {
    workspace.cleanup();
  }
});

test('init requires --preset', async () => {
  const errors = [];
  const result = await runCli(['init', '/tmp/test-project'], {
    stdout: { write: () => {} },
    stderr: { write: (text) => errors.push(String(text)) },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 1);
  assert.match(errors.join(''), /init requires --preset/);
});

test('init requires a project path', async () => {
  const errors = [];
  const result = await runCli(['init', '--preset', 'demo'], {
    stdout: { write: () => {} },
    stderr: { write: (text) => errors.push(String(text)) },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 1);
  assert.match(errors.join(''), /init requires a project path/);
});

test('init refuses to overwrite existing config without --overwrite', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeJson('project/ignorekit.json', { version: 1, name: 'existing' });

    const errors = [];
    const result = await runCli([
      'init',
      workspace.path('project'),
      '--preset',
      'demo',
      '--no-git',
      '--dist-root',
      workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /Config already exists/);
  } finally {
    workspace.cleanup();
  }
});
