'use strict';

const assert = require('assert');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { runExplainWorkflow } = require('../src/workflows/explain');

test('explain shows preset components and custom rules', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n*.log\n');
    workspace.writeText('dist/components/local/secrets.gitignore', '.env\n*.pem\n');
    workspace.writeJson('dist/presets/demo.json', {
      name: 'demo',
      components: ['local/logs']
    });
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'test-project',
      preset: 'demo',
      provider: { name: 'local' },
      components: ['local/secrets'],
      custom: ['/runtime/', 'MIGRATION.md'],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runExplainWorkflow(
      { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    assert.equal(result.project, 'test-project');
    assert.equal(result.preset, 'demo');
    assert.equal(result.components.length, 2);
    assert.equal(result.customCount, 2);

    // Should show preset components
    assert.match(output, /From preset "demo"/);
    assert.match(output, /local\/logs/);

    // Should show extra components
    assert.match(output, /Extra components/);
    assert.match(output, /local\/secrets/);

    // Should show custom rules
    assert.match(output, /Custom rules: 2/);
    assert.match(output, /\/runtime\//);
    assert.match(output, /MIGRATION\.md/);
  } finally {
    workspace.cleanup();
  }
});

test('explain without preset shows no preset section', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n*.log\n');
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'no-preset-project',
      provider: { name: 'local' },
      components: ['local/logs'],
      custom: [],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runExplainWorkflow(
      { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    assert.equal(result.preset, null);
    assert.match(output, /Preset:\s+none/);
  } finally {
    workspace.cleanup();
  }
});

test('explain --verbose shows full component content', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', '# Logs\nlogs/\n*.log\n');
    workspace.writeJson('dist/presets/demo.json', {
      name: 'demo',
      components: ['local/logs']
    });
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'verbose-project',
      preset: 'demo',
      provider: { name: 'local' },
      components: [],
      custom: [],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    runExplainWorkflow(
      { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist'), verbose: true },
      { stdout, cwd: workspace.root }
    );

    // Verbose should include the component content lines (indented)
    assert.match(output, /    # Logs/);
    assert.match(output, /    logs\//);
    assert.match(output, /    \*\.log/);
  } finally {
    workspace.cleanup();
  }
});

test('explain with no custom rules shows zero count', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: [] });
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'no-custom-project',
      preset: 'demo',
      provider: { name: 'local' },
      components: [],
      custom: [],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    runExplainWorkflow(
      { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    assert.match(output, /Custom rules: 0/);
  } finally {
    workspace.cleanup();
  }
});
