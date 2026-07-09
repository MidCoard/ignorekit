'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

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
