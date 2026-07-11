'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('generate writes .gitignore from a project config and does not require Git', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      preset: 'demo',
      provider: { name: 'local' },
      custom: ['/runtime/']
    });

    const result = await runCli(['generate', configPath, '--dist-root', workspace.path('dist')], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.path('project')
    });

    assert.equal(result.exitCode, 0);
    const output = fs.readFileSync(workspace.path('project/.gitignore'), 'utf8');
    assert.match(output, /logs\//);
    assert.match(output, /\/runtime\//);
  } finally {
    workspace.cleanup();
  }
});

test('generate reads project-local definitions from .ignorekit automatically', async () => {
  const workspace = createTempWorkspace();
  try {
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      components: ['local/runtime']
    });
    workspace.writeText('project/.ignorekit/components/local/runtime.gitignore', 'runtime-data/\n');

    const result = await runCli(['generate', configPath, '--dist-root', workspace.path('dist')], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.path('project')
    });

    assert.equal(result.exitCode, 0);
    assert.match(workspace.readText('project/.gitignore'), /runtime-data\//);
  } finally {
    workspace.cleanup();
  }
});

test('generate requires a config path', async () => {
  const errors = [];
  const result = await runCli(['generate'], {
    stdout: { write: () => {} },
    stderr: { write: (text) => errors.push(String(text)) },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 1);
  assert.match(errors.join(''), /generate requires a config path/);
});

test('generate with invalid config produces error containing file path', async () => {
  const workspace = createTempWorkspace();
  try {
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 99,
      name: 'bad'
    });

    const errors = [];
    const result = await runCli(['generate', configPath], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    const errorOutput = errors.join('');
    assert.match(errorOutput, /Invalid config/);
    assert.match(errorOutput, /ignorekit\.json/);
  } finally {
    workspace.cleanup();
  }
});
