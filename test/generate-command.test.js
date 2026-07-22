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

    const result = await runCli(['generate', configPath], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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

test('generate reads user-layer definitions for extra components', async () => {
  const workspace = createTempWorkspace();
  try {
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      components: ['local/runtime']
    });
    workspace.writeText('user/components/local/runtime.gitignore', 'runtime-data/\n');

    const result = await runCli(['generate', configPath], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist'), IGNOREKIT_USER_ROOT: workspace.path('user') },
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

test('generate with no config path defaults to ./ignorekit.json', async () => {
  // When no config path is provided, generate reads ./ignorekit.json in the
  // current working directory. If that file doesn't exist, it errors.
  const workspace = createTempWorkspace();
  try {
    // Use a temp directory that has no ignorekit.json
    const errors = [];
    const result = await runCli(['generate'], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.path('project')  // no ignorekit.json here
    });

    assert.equal(result.exitCode, 1);
    // The error should mention the file not existing
    assert.match(errors.join(''), /ignorekit\.json/);
  } finally {
    workspace.cleanup();
  }
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

test('generate with no args reads ./ignorekit.json from cwd', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      preset: 'demo',
      provider: { name: 'local' },
      custom: []
    });

    // No config path argument — should default to ./ignorekit.json in cwd
    const result = await runCli(['generate'], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.path('project')
    });

    assert.equal(result.exitCode, 0);
    assert.match(workspace.readText('project/.gitignore'), /logs\//);
  } finally {
    workspace.cleanup();
  }
});

// --- #1 (P0): generate must show preview and require confirmation before writing ---

test('generate shows preview before writing and does not write when confirm declines', async () => {
  // When a .gitignore already exists, generate asks for confirmation before
  // overwriting. When the user declines, the existing .gitignore is unchanged.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      preset: 'demo',
      provider: { name: 'local' },
      custom: []
    });
    // Pre-existing .gitignore — this triggers the overwrite confirmation
    workspace.writeText('project/.gitignore', 'old-content\n');
    const originalBytes = fs.readFileSync(workspace.path('project/.gitignore'), 'utf8');

    const output = [];
    // Answer 'y' to "Show preview?" then 'n' to "Overwrite?"
    const answers = ['y', 'n'];
    let answerIndex = 0;
    const result = await runCli(['generate', configPath], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.path('project'),
      ask: async () => answers[answerIndex++]
    });

    assert.equal(result.exitCode, 1, 'generate should exit 1 when user declines overwrite');
    const out = output.join('');
    assert.match(out, /--- Preview/, 'generate must show preview before writing');
    assert.match(out, /End preview/, 'generate must delimit the preview');
    // Existing .gitignore must be unchanged
    assert.equal(fs.readFileSync(workspace.path('project/.gitignore'), 'utf8'), originalBytes,
      'generate must not overwrite .gitignore when user declines');
  } finally {
    workspace.cleanup();
  }
});

test('generate with --confirm skips overwrite prompt and writes the file', async () => {
  // With --confirm, generate bypasses the overwrite prompt and writes directly,
  // even when a .gitignore already exists. Matches the --confirm behavior of
  // init and adopt.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      preset: 'demo',
      provider: { name: 'local' },
      custom: []
    });
    // Pre-existing .gitignore — would normally trigger overwrite prompt
    workspace.writeText('project/.gitignore', 'old-content\n');

    const output = [];
    const result = await runCli(['generate', configPath, '--confirm'], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.path('project')
    });

    assert.equal(result.exitCode, 0, 'generate with --confirm should succeed');
    // The file must be overwritten
    assert.match(workspace.readText('project/.gitignore'), /logs\//);
    // The overwrite prompt must NOT appear
    assert.doesNotMatch(output.join(''), /Overwrite/,
      '--confirm should skip the overwrite prompt');
  } finally {
    workspace.cleanup();
  }
});

test('generate under CI skips confirmation and writes the file', async () => {
  // Under CI (or IGNOREKIT_NONINTERACTIVE), generate must not prompt and
  // must write the file directly, matching the CI behavior of init and adopt.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      preset: 'demo',
      provider: { name: 'local' },
      custom: []
    });

    const prev = process.env.CI;
    process.env.CI = '1';
    try {
      const result = await runCli(['generate', configPath], {
        envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: workspace.path('project')
      });

      assert.equal(result.exitCode, 0, 'generate under CI should succeed without confirm');
      assert.match(workspace.readText('project/.gitignore'), /logs\//);
    } finally {
      if (prev === undefined) delete process.env.CI; else process.env.CI = prev;
    }
  } finally {
    workspace.cleanup();
  }
});
