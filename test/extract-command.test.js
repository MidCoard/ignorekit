'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { USER_ROOT } = require('../src/core/path');

test('extract component writes a reusable component draft', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'logs/\n.env\n');
    const result = await runCli([
      'extract',
      'component',
      'local/runtime',
      '--from',
      workspace.path('project/.gitignore'),
      '--output-root',
      workspace.path('defs'),
      '--full'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const output = fs.readFileSync(workspace.path('defs/components/local/runtime.gitignore'), 'utf8');
    assert.match(output, /logs\//);
    assert.match(output, /\.env/);
  } finally {
    workspace.cleanup();
  }
});

test('extract component rejects invalid ids', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'logs/\n');
    const errors = [];
    const result = await runCli([
      'extract',
      'component',
      '../escape',
      '--from',
      workspace.path('project/.gitignore'),
      '--output-root',
      workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /Invalid definition id/);
  } finally {
    workspace.cleanup();
  }
});

test('extract with analysis only extracts unmatched lines', async () => {
  const workspace = createTempWorkspace();
  try {
    // Set up known components
    workspace.writeText('dist/components/editor/jetbrains.gitignore', '# JetBrains\n.idea/\n*.iml\n*.ipr\n*.iws\n');
    workspace.writeText('dist/components/language/java.gitignore', '# Java\n*.class\nout/\nbin/\n');

    // .gitignore with some known + some custom rules
    workspace.writeText('project/.gitignore', `.idea/
*.iml
*.ipr
*.iws
*.class
out/
bin/
docs/
MIGRATION.md
`);

    const output = [];
    const result = await runCli([
      'extract',
      'component',
      'local/custom',
      '--from',
      workspace.path('project/.gitignore'),
      '--output-root',
      workspace.path('defs'),
      '--dist-root',
      workspace.path('dist')
    ], {
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);

    // The extracted component should contain only unmatched lines
    const component = fs.readFileSync(workspace.path('defs/components/local/custom.gitignore'), 'utf8');
    assert.match(component, /docs\//);
    assert.match(component, /MIGRATION\.md/);
    // Should NOT contain rules that are already in known components
    assert.doesNotMatch(component, /\.idea\//);
    assert.doesNotMatch(component, /\*\.class/);

    // Output should mention analysis
    const outputText = output.join('');
    assert.match(outputText, /Analyzing/);
    assert.match(outputText, /Already covered/);
  } finally {
    workspace.cleanup();
  }
});

test('extract component defaults to user definitions directory', async () => {
  // Test the workflow function directly to verify the default output path
  const { runExtractComponent } = require('../src/workflows/extract');
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'custom-pattern/\n');
    workspace.writeText('dist/components/dummy.gitignore', '# dummy\n');

    const output = [];
    const result = runExtractComponent({
      id: 'local/test-default',
      from: workspace.path('project/.gitignore'),
      distRoot: workspace.path('dist'),
      // No outputRoot — should default to USER_ROOT
    }, {
      stdout: { write: (text) => output.push(String(text)) },
      cwd: workspace.root
    });

    // The output path should be under USER_ROOT (~/.ignorekit)
    assert.ok(result.outputPath, 'Should return an output path');
    assert.ok(
      result.outputPath.includes('.ignorekit') && result.outputPath.includes('components'),
      `Output path should be under user definitions dir, got: ${result.outputPath}`
    );
    assert.ok(
      result.outputPath.includes('local') && result.outputPath.includes('test-default.gitignore'),
      `Output path should include the component id, got: ${result.outputPath}`
    );

    // Output should mention the user definitions layer
    const outputText = output.join('');
    assert.match(outputText, /user definitions layer/);

    // Clean up the file that was written to the real USER_ROOT
    try { fs.rmSync(path.dirname(result.outputPath), { recursive: true, force: true }); } catch {}
  } finally {
    workspace.cleanup();
  }
});

test('extract component with --output-root writes to specified directory', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'custom-pattern/\n');
    const output = [];
    const result = await runCli([
      'extract',
      'component',
      'local/test-override',
      '--from',
      workspace.path('project/.gitignore'),
      '--output-root',
      workspace.path('custom-output'),
      '--full'
    ], {
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const componentPath = workspace.path('custom-output/components/local/test-override.gitignore');
    assert.ok(fs.existsSync(componentPath), 'Component should be written to custom output root');

    // Should NOT mention user definitions layer when --output-root is specified
    const outputText = output.join('');
    assert.doesNotMatch(outputText, /user definitions layer/);
  } finally {
    workspace.cleanup();
  }
});
