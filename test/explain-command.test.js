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

test('explain resolves user-layer definitions for extra components', () => {
  const workspace = createTempWorkspace();
  try {
    // Dist has a preset but no user-specific component
    workspace.writeJson('dist/presets/demo.json', {
      name: 'demo',
      components: ['local/logs']
    });
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    // User layer: a custom component that the project references as extra
    workspace.writeText('user/components/local/custom-rule.gitignore', 'custom-data/\n');
    workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project-test',
      preset: 'demo',
      provider: { name: 'local' },
      components: ['local/custom-rule'],
      custom: [],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runExplainWorkflow(
      { configPath: workspace.path('project/ignorekit.json'), distRoot: workspace.path('dist'), userRoot: workspace.path('user') },
      { stdout, cwd: workspace.root }
    );

    // The user-layer component must be resolved
    assert.equal(result.components.length, 2);
    assert.match(output, /local\/custom-rule/);
  } finally {
    workspace.cleanup();
  }
});

test('explain skips missing preset component instead of crashing', () => {
  const workspace = createTempWorkspace();
  try {
    // Preset references a component that does not exist on disk.
    // The explain workflow must skip it gracefully rather than throwing
    // DefinitionNotFoundError.
    workspace.writeJson('dist/presets/demo.json', {
      name: 'demo',
      components: ['local/missing']
    });
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'missing-component-project',
      preset: 'demo',
      provider: { name: 'local' },
      components: [],
      custom: [],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    // Must not throw — missing component is skipped
    const result = runExplainWorkflow(
      { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    assert.equal(result.project, 'missing-component-project');
    assert.equal(result.preset, 'demo');
    // The missing component should not appear in the component list
    assert.ok(!result.components.includes('local/missing'));
  } finally {
    workspace.cleanup();
  }
});

test('explain skips missing extra component instead of crashing', () => {
  const workspace = createTempWorkspace();
  try {
    // Config references an extra component that does not exist on disk.
    workspace.writeJson('dist/presets/demo.json', {
      name: 'demo',
      components: []
    });
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'missing-extra-project',
      preset: 'demo',
      provider: { name: 'local' },
      components: ['local/nonexistent'],
      custom: [],
      addons: {}
    });

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    // Must not throw — missing extra component is skipped
    const result = runExplainWorkflow(
      { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    assert.equal(result.project, 'missing-extra-project');
    assert.ok(!result.components.includes('local/nonexistent'));
  } finally {
    workspace.cleanup();
  }
});

// --- debugError env contract: printComponentDetail must pass full env ---

test('explain routes debugError for unreadable component to env.stderr', () => {
  // When IGNOREKIT_DEBUG=1 and a component cannot be read, the debug output
  // must go to env.stderr (via the full env object), not leak to process.stderr.
  // This tests that printComponentDetail receives full { stdout, stderr, cwd }
  // env instead of a partial { stdout, stderr } streams object.
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/demo.json', {
      name: 'demo',
      components: ['local/secret']
    });
    workspace.writeJson('ignorekit.json', {
      version: 1,
      name: 'debug-test',
      preset: 'demo',
      provider: { name: 'local' },
      components: [],
      custom: [],
      addons: {}
    });

    // Create the component file, then mock readComponent to throw EACCES
    workspace.writeText('dist/components/local/secret.gitignore', 'secret/\n');
    const fs = require('fs');
    const origReadFileSync = fs.readFileSync;
    const secretPath = workspace.path('dist/components/local/secret.gitignore');
    fs.readFileSync = function(filePath, encoding) {
      if (filePath === secretPath) {
        const err = new Error('EACCES: permission denied');
        err.code = 'EACCES';
        throw err;
      }
      return origReadFileSync.apply(this, arguments);
    };

    const origDebug = process.env.IGNOREKIT_DEBUG;
    process.env.IGNOREKIT_DEBUG = '1';
    const stderrChunks = [];
    try {
      const result = runExplainWorkflow(
        { configPath: workspace.path('ignorekit.json'), distRoot: workspace.path('dist') },
        {
          stdout: { write: () => {} },
          stderr: { write: (text) => stderrChunks.push(String(text)) },
          cwd: workspace.root
        }
      );

      // The component should be skipped, not crash
      assert.equal(result.project, 'debug-test');
      assert.ok(!result.components.includes('local/secret'));

      // Debug output must appear in env.stderr, not leak to process.stderr
      const stderrText = stderrChunks.join('');
      assert.match(stderrText, /EACCES|permission denied/,
        `debug output should appear in env.stderr, got: ${stderrText || '(empty)'}`);
    } finally {
      process.env.IGNOREKIT_DEBUG = origDebug;
      fs.readFileSync = origReadFileSync;
    }
  } finally {
    workspace.cleanup();
  }
});
