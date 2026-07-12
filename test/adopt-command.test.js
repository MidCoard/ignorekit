'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('adopt with --preset skips interactive picker', async () => {
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
  } finally {
    workspace.cleanup();
  }
});

test('adopt keeps explicit extra components and avoids duplicating selected preset rules as custom', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/language/java.gitignore', [
      '*.class', 'out/', 'bin/', '.settings/', '.classpath', '.project'
    ].join('\n') + '\n');
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n.vite/\n');
    workspace.writeJson('dist/presets/java.json', { name: 'java', components: ['language/java'] });
    workspace.writeText('project/.gitignore', '*.class\nnode_modules/\n.vite/\nproject-private/\n');

    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'java',
      '--component', 'language/node', '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(workspace.readText('project/ignorekit.json'));
    assert.deepEqual(config.components, ['language/node']);
    assert.deepEqual(config.custom, ['project-private/']);
  } finally {
    workspace.cleanup();
  }
});

test('adopt defaults path to current directory', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
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
    assert.equal(fs.existsSync(workspace.path('ignorekit.json')), true);
  } finally {
    workspace.cleanup();
  }
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
        removeCached: true,
        apply: true
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

test('adopt refuses cached removal until the generated ignore file is applied', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const errors = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo', '--remove-cached', '--yes',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /requires --apply/);
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false);
  } finally {
    workspace.cleanup();
  }
});

test('adopt overwrites .gitignore directly and saves backup of original', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Existing .gitignore
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

    // .gitignore should be overwritten with the new content
    const gitignore = workspace.readText('project/.gitignore');
    assert.match(gitignore, /logs\//);
    assert.match(gitignore, /Generated by ignorekit/);
    // The original file content lives in the backup now
    assert.equal(workspace.readText('project/.gitignore.bak'), 'old-rule\n');

    // .gitignore.bak should contain the original content
    const backup = workspace.readText('project/.gitignore.bak');
    assert.equal(backup, 'old-rule\n');
  } finally {
    workspace.cleanup();
  }
});

test('adopt does not create .gitignore.preview file', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    await runCli([
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

    // No .gitignore.preview file should be created — preview is console-only
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.preview')), false,
      '.gitignore.preview file should not be created');
  } finally {
    workspace.cleanup();
  }
});

test('adopt creates .gitignore directly when none existed', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Create the project directory but no .gitignore
    workspace.writeText('project/.gitkeep', '');

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

    // .gitignore should exist
    assert.ok(fs.existsSync(workspace.path('project/.gitignore')), '.gitignore should be created');
    assert.match(workspace.readText('project/.gitignore'), /logs\//);

    // No .gitignore.preview file
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.preview')), false);
  } finally {
    workspace.cleanup();
  }
});
