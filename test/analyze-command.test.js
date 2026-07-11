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

test('parseSignificantLines preserves gitignore pattern syntax', () => {
  const lines = parseSignificantLines('# Comment\n\\#literal-name\n  leading-space\ntrailing-space\\ \n');
  assert.deepEqual(lines, ['\\#literal-name', '  leading-space', 'trailing-space\\ ']);
});

test('matchComponent keeps directory-only patterns distinct from file patterns', () => {
  const result = matchComponent(['build'], 'build/\n');
  assert.equal(result.matched.length, 0);
  assert.deepEqual(result.unmatched, ['build/']);
});

test('analyze discovers user-layer components', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('.gitignore', 'personal-cache/\n');
    workspace.writeText('user/components/local/personal.gitignore', 'personal-cache/\n');

    const result = runAnalyzeWorkflow({
      gitignorePath: workspace.path('.gitignore'),
      distRoot: workspace.path('dist'),
      userRoot: workspace.path('user')
    }, { stdout: { write: () => {} }, cwd: workspace.root });

    assert.deepEqual(result.matchedComponents, [{
      id: 'local/personal',
      matched: 1,
      total: 1,
      classification: 'full'
    }]);
    assert.deepEqual(result.unmatchedLines, []);
  } finally {
    workspace.cleanup();
  }
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

test('scorePreset weights completeness over raw count', () => {
  const componentResults = new Map();
  componentResults.set('a', { matched: ['x'], unmatched: [], total: 1, ratio: 1.0 });
  componentResults.set('b', { matched: ['y'], unmatched: ['z'], total: 2, ratio: 0.5 });
  componentResults.set('c', { matched: [], unmatched: ['w'], total: 1, ratio: 0.0 });

  // Preset with 1 full + 1 partial out of 2
  const score1 = scorePreset(['a', 'b'], componentResults);
  assert.equal(score1.fullCount, 1);
  assert.equal(score1.partialCount, 1);

  // Preset with 0 matches (all miss)
  const score2 = scorePreset(['c'], componentResults);
  assert.equal(score2.fullCount, 0);
  assert.ok(score1.score > score2.score, 'partial match should beat no match');
});

test('scorePreset: preset covering more input lines wins over more complete preset', () => {
  // A preset with 9/10 matched components covers more input than 8/8 perfect.
  // With the new scoring, input coverage is the primary signal.
  const componentResults = new Map();
  for (let i = 1; i <= 9; i++) {
    componentResults.set(`comp${i}`, { matched: [`x${i}`], unmatched: [], total: 1, ratio: 1.0 });
  }

  // 8 components, all fully matched = perfect completeness but fewer matched lines
  const perfect = scorePreset(['comp1','comp2','comp3','comp4','comp5','comp6','comp7','comp8'], componentResults, 20);
  // 10 components, 9 matched, 1 miss = imperfect but covers more input
  const imperfect = scorePreset(['comp1','comp2','comp3','comp4','comp5','comp6','comp7','comp8','comp9','comp10'], componentResults, 20);

  // The imperfect preset covers more input lines (9 vs 8) — should win
  assert.ok(imperfect.score > perfect.score, `imperfect 9/10 (${imperfect.score}) should beat perfect 8/8 (${perfect.score}) because it covers more input`);
});

test('analyze scores base-inheriting presets correctly', () => {
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

    // A .gitignore that matches vite's full chain
    workspace.writeText('.gitignore', `.DS_Store
node_modules/
dist/
`);

    let output = '';
    const stdout = { write: (s) => { output += s; } };

    const result = runAnalyzeWorkflow(
      { gitignorePath: workspace.path('.gitignore'), distRoot: workspace.path('dist'), suggestPreset: true },
      { stdout, cwd: workspace.root }
    );

    // vite should score highest (all 3 components matched)
    assert.ok(result.bestPreset, 'Should suggest a preset');
    assert.equal(result.bestPreset.id, 'vite', 'Should suggest vite for Vite .gitignore');
  } finally {
    workspace.cleanup();
  }
});

test('scorePreset with line coverage: preset covering more lines wins', () => {
  // Simulate a Java project where java-gradle matches components covering many lines
  // but rust matches more components covering few lines
  const componentResults = new Map();
  // java-gradle's components cover many lines
  componentResults.set('editor/jetbrains', { matched: ['.idea/', '*.iml', '*.ipr', '*.iws'], unmatched: [], total: 4, ratio: 1.0 });
  componentResults.set('language/java', { matched: ['*.class', 'out/', 'bin/'], unmatched: [], total: 3, ratio: 1.0 });
  componentResults.set('build/gradle', { matched: ['.gradle/', 'build/'], unmatched: [], total: 2, ratio: 1.0 });
  componentResults.set('platform/macos', { matched: ['.DS_Store'], unmatched: [], total: 1, ratio: 1.0 });
  componentResults.set('platform/windows', { matched: ['Thumbs.db', 'Desktop.ini'], unmatched: [], total: 2, ratio: 1.0 });

  const totalInputLines = 12;

  // java-gradle: 5 fully matched components, covering 12 lines
  const javaGradle = scorePreset(
    ['editor/jetbrains', 'language/java', 'build/gradle', 'platform/macos', 'platform/windows', 'local/env-secrets', 'local/logs', 'editor/java-ide-metadata', 'editor/temporary-files', 'local/assistant-artifacts', 'local/ai-claude'],
    componentResults, totalInputLines
  );

  // rust: 5 fully matched, covering only 3 lines (just platform components)
  const rust = scorePreset(
    ['platform/macos', 'platform/windows', 'language/rust', 'build/cargo', 'editor/jetbrains', 'local/env-secrets', 'local/logs', 'editor/temporary-files', 'local/assistant-artifacts'],
    componentResults, totalInputLines
  );

  // java-gradle should score higher because its matched components cover more of the input
  assert.ok(javaGradle.score > rust.score,
    `java-gradle (${javaGradle.score}) should beat rust (${rust.score}) when java-gradle covers more lines`);
});
