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

test('adopt refuses to overwrite existing config without --overwrite-config', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeJson('project/ignorekit.json', { version: 1, name: 'existing' });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const errors = [];
    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
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

test('adopt with --overwrite-config replaces existing config', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeJson('project/ignorekit.json', { version: 1, name: 'existing' });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist'),
      '--overwrite-config'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(workspace.readText('project/ignorekit.json'));
    assert.equal(config.name, 'project');
  } finally {
    workspace.cleanup();
  }
});

test('adopt --remove-cached dry-run prints file list to stdout', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    // Clear require cache so adopt picks up mocked git
    delete require.cache[require.resolve('../src/workflows/adopt')];
    delete require.cache[require.resolve('../src/git')];

    const git = require('../src/git');
    const origList = git.listTrackedIgnoredFiles;
    const origRemove = git.removeCachedFiles;
    git.listTrackedIgnoredFiles = () => ['secret.key', 'debug.log'];
    git.removeCachedFiles = (_projectPath, files, opts) => {
      return { action: 'dry-run', files };
    };

    const { runAdoptWorkflow } = require('../src/workflows/adopt');

    const writes = [];
    try {
      await runAdoptWorkflow({
        projectPath: workspace.path('project'),
        preset: 'demo',
        distRoot: workspace.path('dist'),
        removeCached: true
      }, {
        cwd: workspace.root,
        stdout: { write: (text) => writes.push(String(text)) }
      });

      const output = writes.join('');
      assert.match(output, /secret\.key/);
      assert.match(output, /debug\.log/);
    } finally {
      git.listTrackedIgnoredFiles = origList;
      git.removeCachedFiles = origRemove;
      delete require.cache[require.resolve('../src/workflows/adopt')];
      delete require.cache[require.resolve('../src/git')];
    }
  } finally {
    workspace.cleanup();
  }
});
