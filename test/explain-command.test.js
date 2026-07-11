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
    assert.match(output, /From "demo"/);
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

test('explain shows inheritance chain for base-inheriting preset', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/platform/macos.gitignore', '.DS_Store\n');
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/framework/vite.gitignore', 'dist/\n');
    workspace.writeJson('dist/presets/generic.json', {
      name: 'generic',
      components: ['platform/macos']
    });
    workspace.writeJson('dist/presets/node.json', {
      name: 'node',
      base: 'generic',
      components: ['language/node']
    });
    workspace.writeJson('dist/presets/vite.json', {
      name: 'vite',
      base: 'node',
      components: ['framework/vite']
    });
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'vite-project',
      preset: 'vite',
      provider: { name: 'local' },
      components: [],
      custom: [],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runExplainWorkflow(
      { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    // Should show the inheritance chain in the header
    assert.match(output, /extends generic → node/);
    // Should show components grouped by level
    assert.match(output, /From generic:/);
    assert.match(output, /From node:/);
    assert.match(output, /From "vite":/);
    // Should show all 3 components
    assert.equal(result.components.length, 3);
  } finally {
    workspace.cleanup();
  }
});

test('explain shows excluded components and filters them from output', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/platform/macos.gitignore', '.DS_Store\n');
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/framework/vite.gitignore', 'dist/\n');
    workspace.writeJson('dist/presets/node.json', {
      name: 'node',
      components: ['platform/macos', 'language/node']
    });
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'exclude-test',
      preset: 'node',
      exclude: ['platform/macos'],
      provider: { name: 'local' },
      components: ['framework/vite'],
      custom: [],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runExplainWorkflow(
      { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    // Should show excluded section
    assert.match(output, /Excluded from preset:/);
    assert.match(output, /platform\/macos/);

    // Should NOT include the excluded component in the component list
    assert.equal(result.components.length, 2); // language/node + framework/vite
    assert.ok(!result.components.includes('platform/macos'));

    // Should show the framework/vite extra component
    assert.match(output, /framework\/vite/);
  } finally {
    workspace.cleanup();
  }
});
