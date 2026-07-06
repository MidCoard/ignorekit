'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('adopt writes ignorekit config and preview gitignore by default', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), true);
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.preview')), true);
    assert.equal(workspace.readText('project/.gitignore'), 'old-rule\n');
  } finally {
    workspace.cleanup();
  }
});

test('adopt with --apply overwrites the .gitignore directly', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist'),
      '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.preview')), false);
    const content = workspace.readText('project/.gitignore');
    assert.match(content, /logs\//);
    assert.doesNotMatch(content, /old-rule/);
  } finally {
    workspace.cleanup();
  }
});

test('adopt requires --preset', async () => {
  const errors = [];
  const result = await runCli(['adopt', '/tmp/test-project'], {
    stdout: { write: () => {} },
    stderr: { write: (text) => errors.push(String(text)) },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 1);
  assert.match(errors.join(''), /adopt requires --preset/);
});

test('adopt requires a project path', async () => {
  const errors = [];
  const result = await runCli(['adopt', '--preset', 'demo'], {
    stdout: { write: () => {} },
    stderr: { write: (text) => errors.push(String(text)) },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 1);
  assert.match(errors.join(''), /adopt requires a project path/);
});
