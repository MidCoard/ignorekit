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

test('generate reads user-layer definitions for extra components', async () => {
  const workspace = createTempWorkspace();
  try {
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      components: ['local/runtime']
    });
    workspace.writeText('user/components/local/runtime.gitignore', 'runtime-data/\n');

    const result = await runCli(['generate', configPath, '--dist-root', workspace.path('dist'), '--user-root', workspace.path('user')], {
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

// --- #1 (P0): generate must show preview and require confirmation before writing ---

test('generate shows preview before writing and does not write when confirm declines', async () => {
  // Without --yes, generate must show a preview and ask for confirmation.
  // When the user declines, no .gitignore should be written.
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

    const output = [];
    // Answer 'y' to "Show preview?" then 'n' to "Proceed?"
    const answers = ['y', 'n'];
    let answerIndex = 0;
    const result = await runCli(['generate', configPath, '--dist-root', workspace.path('dist')], {
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.path('project'),
      ask: async () => answers[answerIndex++]
    });

    assert.equal(result.exitCode, 1, 'generate should exit 1 when user declines confirm');
    const out = output.join('');
    assert.match(out, /--- Preview/, 'generate must show preview before writing');
    assert.match(out, /End preview/, 'generate must delimit the preview');
    // No .gitignore should be written when the user declines
    assert.equal(fs.existsSync(workspace.path('project/.gitignore')), false,
      'generate must not write .gitignore when user declines confirm');
  } finally {
    workspace.cleanup();
  }
});

test('generate --yes skips confirmation and writes the file', async () => {
  // With --yes, generate must bypass the confirm prompt and write directly,
  // matching the --yes behavior of init and adopt.
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

    const output = [];
    const result = await runCli(['generate', configPath, '--dist-root', workspace.path('dist'), '--yes'], {
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.path('project')
    });

    assert.equal(result.exitCode, 0, 'generate --yes should succeed');
    // The file must be written
    assert.match(workspace.readText('project/.gitignore'), /logs\//);
    // With --yes, the preview question is skipped (no interactive prompt)
    assert.doesNotMatch(output.join(''), /Show preview/);
    // The confirm prompt must NOT appear
    assert.doesNotMatch(output.join(''), /Proceed\?/,
      '--yes should not show the Proceed? prompt');
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
      const result = await runCli(['generate', configPath, '--dist-root', workspace.path('dist')], {
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: workspace.path('project')
      });

      assert.equal(result.exitCode, 0, 'generate under CI should succeed without --yes');
      assert.match(workspace.readText('project/.gitignore'), /logs\//);
    } finally {
      if (prev === undefined) delete process.env.CI; else process.env.CI = prev;
    }
  } finally {
    workspace.cleanup();
  }
});
