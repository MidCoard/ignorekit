'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('init with --preset skips interactive picker', async () => {
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

test('init defaults path to current directory', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });

    const result = await runCli([
      'init',
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
    // Should create ignorekit.json in cwd (workspace.root)
    assert.equal(fs.existsSync(workspace.path('ignorekit.json')), true);
  } finally {
    workspace.cleanup();
  }
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

test('init preserves an existing .gitignore without --overwrite', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'keep-this-rule\n');

    const errors = [];
    const result = await runCli([
      'init', workspace.path('project'), '--preset', 'demo', '--no-git',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /Ignore file already exists/);
    assert.equal(workspace.readText('project/.gitignore'), 'keep-this-rule\n');
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false);
  } finally {
    workspace.cleanup();
  }
});

test('init checks nested Git state before creating managed files', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    const gitInit = childProcess.spawnSync('git', ['init'], { cwd: workspace.root, encoding: 'utf8' });
    assert.equal(gitInit.status, 0);

    const errors = [];
    const result = await runCli([
      'init', workspace.path('project'), '--preset', 'demo', '--git',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /Refusing to initialize nested Git repo/);
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false);
    assert.equal(fs.existsSync(workspace.path('project/.gitignore')), false);
  } finally {
    workspace.cleanup();
  }
});
