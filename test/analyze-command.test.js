'use strict';

const assert = require('assert');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { runAnalyzeWorkflow, parseSignificantLines, matchComponent, classifyMatch, scorePreset } = require('../src/workflows/analyze');

test('analyze matches components against .gitignore', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/editor/jetbrains.gitignore', '# JetBrains\n.idea/\n*.iml\n*.ipr\n*.iws\n');
    workspace.writeText('dist/components/language/java.gitignore', '# Java\n*.class\nout/\nbin/\n');
    workspace.writeText('dist/components/local/logs.gitignore', '# Logs\nlogs/\n*.log\nnpm-debug.log*\n');
    workspace.writeJson('dist/presets/java-gradle.json', {
      name: 'java-gradle',
      components: ['editor/jetbrains', 'language/java', 'local/logs']
    });

    // A .gitignore that has JetBrains + Java but not logs
    workspace.writeText('.gitignore', `.idea/
*.iml
*.ipr
*.iws
*.class
out/
bin/
docs/
MIGRATION.md
`);

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runAnalyzeWorkflow(
      { gitignorePath: workspace.path('.gitignore'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    // Should find jetbrains and java as full matches
    const fullMatches = result.matchedComponents.filter(c => c.classification === 'full');
    const partialMatches = result.matchedComponents.filter(c => c.classification === 'partial');
    assert.ok(fullMatches.length >= 2, 'Should have at least 2 full matches (jetbrains + java)');

    // Should have unmatched lines
    assert.ok(result.unmatchedLines.length >= 2, 'Should have unmatched lines (docs/, MIGRATION.md)');
    assert.ok(result.unmatchedLines.includes('docs/'));
    assert.ok(result.unmatchedLines.includes('MIGRATION.md'));
  } finally {
    workspace.cleanup();
  }
});

test('analyze --suggest-preset suggests best matching preset', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/editor/jetbrains.gitignore', '# JetBrains\n.idea/\n*.iml\n*.ipr\n*.iws\n');
    workspace.writeText('dist/components/language/java.gitignore', '# Java\n*.class\nout/\nbin/\n');
    workspace.writeText('dist/components/language/node.gitignore', '# Node\nnode_modules/\ndist/\n');
    workspace.writeJson('dist/presets/java-gradle.json', {
      name: 'java-gradle',
      components: ['editor/jetbrains', 'language/java']
    });
    workspace.writeJson('dist/presets/frontend-vite.json', {
      name: 'frontend-vite',
      components: ['language/node']
    });

    // A Java-like .gitignore
    workspace.writeText('.gitignore', `.idea/
*.iml
*.ipr
*.iws
*.class
out/
bin/
`);

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runAnalyzeWorkflow(
      { gitignorePath: workspace.path('.gitignore'), distRoot: workspace.path('dist'), suggestPreset: true },
      { stdout, cwd: workspace.root }
    );

    assert.ok(result.bestPreset, 'Should suggest a preset');
    assert.equal(result.bestPreset.id, 'java-gradle', 'Should suggest java-gradle for Java .gitignore');
    assert.match(output, /Best preset match: java-gradle/);
  } finally {
    workspace.cleanup();
  }
});

test('analyze with fully covered .gitignore has no unmatched lines', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/editor/jetbrains.gitignore', '# JetBrains\n.idea/\n*.iml\n*.ipr\n*.iws\n');

    // .gitignore that exactly matches the component
    workspace.writeText('.gitignore', `.idea/
*.iml
*.ipr
*.iws
`);

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runAnalyzeWorkflow(
      { gitignorePath: workspace.path('.gitignore'), distRoot: workspace.path('dist') },
      { stdout, cwd: workspace.root }
    );

    assert.equal(result.unmatchedLines.length, 0, 'All lines should be covered');
    assert.match(output, /none — all lines are covered/);
  } finally {
    workspace.cleanup();
  }
});

test('parseSignificantLines strips comments and blanks', () => {
  const content = '# Header\n\n.idea/\n*.iml\n  \n# Comment\n*.ipr\n';
  const lines = parseSignificantLines(content);
  assert.deepEqual(lines, ['.idea/', '*.iml', '*.ipr']);
});

test('matchComponent computes correct ratio', () => {
  const inputSet = new Set(['.idea/', '*.iml', '*.ipr', '*.iws']);
  const content = '# JetBrains\n.idea/\n*.iml\n*.ipr\n*.iws\n';
  const result = matchComponent(inputSet, content);
  assert.equal(result.matched.length, 4);
  assert.equal(result.total, 4);
  assert.equal(result.ratio, 1.0);
});

test('classifyMatch thresholds work correctly', () => {
  assert.equal(classifyMatch(1.0), 'full');
  assert.equal(classifyMatch(0.8), 'full');
  assert.equal(classifyMatch(0.79), 'partial');
  assert.equal(classifyMatch(0.3), 'partial');
  assert.equal(classifyMatch(0.29), 'none');
  assert.equal(classifyMatch(0.0), 'none');
});

test('scorePreset weights full matches higher than partial', () => {
  const componentResults = new Map();
  componentResults.set('a', { matched: ['x'], unmatched: [], total: 1, ratio: 1.0 });
  componentResults.set('b', { matched: ['y'], unmatched: ['z'], total: 2, ratio: 0.5 });
  componentResults.set('c', { matched: [], unmatched: ['w'], total: 1, ratio: 0.0 });

  const score1 = scorePreset(['a', 'b'], componentResults);
  assert.equal(score1.fullCount, 1);
  assert.equal(score1.partialCount, 1);
  assert.equal(score1.score, 3); // full*2 + partial*1 = 2+1

  const score2 = scorePreset(['c'], componentResults);
  assert.equal(score2.score, 0); // miss = 0
});
