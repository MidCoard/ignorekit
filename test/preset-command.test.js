'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('preset create writes a preset with base and component references', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'preset',
      'create',
      'java-gradle-extended',
      '--base',
      'java-gradle',
      '--component',
      'local/custom-runtime',
      '--output-root',
      workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const preset = JSON.parse(fs.readFileSync(workspace.path('defs/presets/java-gradle-extended.json'), 'utf8'));
    assert.equal(preset.name, 'java-gradle-extended');
    assert.equal(preset.base, 'java-gradle');
    assert.deepEqual(preset.components, ['local/custom-runtime']);
  } finally {
    workspace.cleanup();
  }
});

test('preset create with multiple components', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'preset',
      'create',
      'full-stack',
      '--component',
      'language/java',
      '--component',
      'language/node',
      '--output-root',
      workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const preset = JSON.parse(fs.readFileSync(workspace.path('defs/presets/full-stack.json'), 'utf8'));
    assert.equal(preset.name, 'full-stack');
    assert.deepEqual(preset.components, ['language/java', 'language/node']);
  } finally {
    workspace.cleanup();
  }
});
