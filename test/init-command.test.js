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

test('init --git reports when the target is already a Git repository', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    fs.mkdirSync(workspace.path('project/.git'), { recursive: true });
    const output = [];

    const result = await runCli([
      'init', workspace.path('project'), '--preset', 'demo', '--git',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.match(output.join(''), /Git: already present/);
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

// --- #2 (Round 1): init should collect repeated --component flags ---

test('init --component forwards repeated components into ignorekit.json', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });

    const result = await runCli([
      'init', workspace.path('project'), '--preset', 'demo',
      '--component', 'language/node',
      '--no-git',
      '--dist-root', workspace.path('dist'),
      '--yes'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const configPath = workspace.path('project/ignorekit.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(cfg.components.includes('language/node'),
      `expected components to include language/node, got: ${JSON.stringify(cfg.components)}`);
  } finally {
    workspace.cleanup();
  }
});

// --- #7 (P1): init must check git state BEFORE writing files ---

test('init with --git does not write files when nested git check fails', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Initialize a git repo at the workspace root so the project dir is inside a parent repo.
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
    // The git check must fire BEFORE any files are written — no half-initialized state.
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false,
      'config must not be written when git check fails');
    assert.equal(fs.existsSync(workspace.path('project/.gitignore')), false,
      '.gitignore must not be written when git check fails');
  } finally {
    workspace.cleanup();
  }
});

// --- #2/#3 (Round 6): init confirm gate and --yes handling ---

test('init shows preview and asks for confirmation before writing files', async () => {
  // Init should follow the same pattern as adopt: show a preview of the
  // generated .gitignore and ask the user to confirm before writing. Without
  // a confirm gate, init writes files immediately — a dangerous default for a
  // command that creates both ignorekit.json and .gitignore.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });

    let confirmCalled = false;
    const result = await runCli([
      'init', workspace.path('project'),
      '--preset', 'demo',
      '--no-git',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root,
      ask: async (prompt) => {
        if (/Pick a preset/.test(prompt)) return 'demo';
        if (/Proceed|confirm/i.test(prompt)) {
          confirmCalled = true;
          return 'n';
        }
        return '';
      }
    });

    // The user declined the confirm — no files should be written.
    assert.ok(confirmCalled, 'init should ask for confirmation before writing');
    assert.equal(result.exitCode, 1, 'init should exit 1 when user declines confirm');
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false,
      'config must not be written when user declines confirm');
    assert.equal(fs.existsSync(workspace.path('project/.gitignore')), false,
      '.gitignore must not be written when user declines confirm');
  } finally {
    workspace.cleanup();
  }
});

test('init --yes skips the confirmation prompt and writes files', async () => {
  // The --yes flag should bypass the confirm gate, just like it does for
  // adopt and create. Previously --yes was parsed but ignored by init.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });

    let askCalled = false;
    const result = await runCli([
      'init', workspace.path('project'),
      '--preset', 'demo',
      '--no-git',
      '--dist-root', workspace.path('dist'),
      '--yes'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root,
      ask: async () => { askCalled = true; return 'n'; }
    });

    assert.equal(result.exitCode, 0, 'init --yes should succeed without confirm');
    assert.equal(askCalled, false, '--yes should skip the confirm prompt');
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), true,
      'config should be written with --yes');
    assert.equal(fs.existsSync(workspace.path('project/.gitignore')), true,
      '.gitignore should be written with --yes');
  } finally {
    workspace.cleanup();
  }
});

test('init confirm=y writes files', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });

    const result = await runCli([
      'init', workspace.path('project'),
      '--preset', 'demo',
      '--no-git',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root,
      ask: async (prompt) => {
        if (/Pick a preset/.test(prompt)) return 'demo';
        if (/Proceed|confirm/i.test(prompt)) return 'y';
        return '';
      }
    });

    assert.equal(result.exitCode, 0, 'init should succeed when user confirms');
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), true,
      'config should be written when user confirms');
    assert.equal(fs.existsSync(workspace.path('project/.gitignore')), true,
      '.gitignore should be written when user confirms');
  } finally {
    workspace.cleanup();
  }
});
