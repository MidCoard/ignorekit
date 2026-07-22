'use strict';

const assert = require('assert');
const path = require('path');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { runAnalyzeWorkflow, matchComponent, classifyMatch, scorePreset } = require('../src/workflows/analyze');
const { parseSignificantLines } = require('../src/core/text');

test('analyze reads the source .gitignore only once', () => {
  const workspace = createTempWorkspace();
  const fs = require('fs');
  const gitignorePath = workspace.path('.gitignore');
  try {
    workspace.writeText('dist/components/editor/jetbrains.gitignore', '# JetBrains\n.idea/\n*.iml\n');
    workspace.writeText('.gitignore', '.idea/\n*.iml\ncustom/\n');

    const origReadFileSync = fs.readFileSync;
    let readCount = 0;
    fs.readFileSync = function (file, ...rest) {
      if (typeof file === 'string' && path.resolve(file) === path.resolve(gitignorePath)) {
        readCount += 1;
      }
      return origReadFileSync.call(this, file, ...rest);
    };

    try {
      runAnalyzeWorkflow(
        { gitignorePath, distRoot: workspace.path('dist') },
        { stdout: { write: () => {} }, cwd: workspace.root }
      );
    } finally {
      fs.readFileSync = origReadFileSync;
    }

    assert.equal(readCount, 1, 'the .gitignore should be read exactly once');
  } finally {
    workspace.cleanup();
  }
});

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

test('analyze prefers Vite when package.json identifies Vite over generic matching', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/platform/macos.gitignore', '.DS_Store\n');
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/framework/vite.gitignore', 'dist/\n');
    workspace.writeJson('dist/presets/generic.json', { name: 'generic', components: ['platform/macos'] });
    workspace.writeJson('dist/presets/node.json', { name: 'node', base: 'generic', components: ['language/node'] });
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', base: 'node', components: ['framework/vite'] });
    workspace.writeJson('project/package.json', { scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } });
    workspace.writeText('project/.gitignore', '.DS_Store\n');

    let output = '';
    const result = runAnalyzeWorkflow({
      gitignorePath: workspace.path('project/.gitignore'),
      distRoot: workspace.path('dist'),
      suggestPreset: true
    }, { stdout: { write: text => { output += text; } }, cwd: workspace.root });

    assert.equal(result.bestPreset.id, 'vite');
    assert.match(output, /Vite detected in package.json/);
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

test('analyze hides one-rule partial matches that share a generic output directory', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/framework/next.gitignore', '.next/\nout/\n');
    workspace.writeText('dist/components/build/gradle.gitignore', '.gradle/\nbuild/\n.gradle-cache/\nreports/\n');
    workspace.writeText('.gitignore', '.gradle/\nbuild/\nout/\n');

    let output = '';
    const result = runAnalyzeWorkflow({
      gitignorePath: workspace.path('.gitignore'),
      distRoot: workspace.path('dist')
    }, { stdout: { write: text => { output += text; } }, cwd: workspace.root });

    assert.match(output, /build\/gradle/);
    assert.doesNotMatch(output, /framework\/next/);
    assert.deepEqual(result.matchedComponents.map(component => component.id), ['build/gradle']);
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

test('matchComponent treats trailing-slash patterns as equivalent to their non-slash form', () => {
  // Git treats "build" and "build/" identically for matching purposes (the slash
  // only restricts the pattern to directories, but both ignore the same files).
  // normalizePattern strips trailing slashes so that ".codegraph" in a user's
  // .gitignore matches ".codegraph/" in a component definition.
  const result = matchComponent(['build'], 'build/\n');
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
});

test('matchComponent treats dir/ as equivalent to dir/* for matching', () => {
  // A user's .gitignore has ".vscode/" (ignore the directory). The component
  // has ".vscode/*" (ignore contents, with negations for specific files).
  // For matching purposes they cover the same files — normalizePattern strips
  // the trailing "/*" so ".vscode/" matches ".vscode/*".
  const result = matchComponent(['.vscode/'], '.vscode/*\n!.vscode/settings.json\n');
  assert.equal(result.matched.length, 1,
    `.vscode/ should match .vscode/*; got ${result.matched.length} matched`);
  // The negation line is a separate rule and won't match .vscode/ — that's
  // correct. The important thing is the parent directory pattern matches.
});

test('matchComponent treats /pattern as equivalent to pattern for matching', () => {
  // A user's .gitignore has "/nbproject/private/" (anchored to root). The
  // component has "nbproject/private/" (matches at any level). For matching
  // purposes they are equivalent — normalizePattern strips leading slashes.
  const result = matchComponent(['/nbproject/private/'], 'nbproject/private/\n');
  assert.equal(result.matched.length, 1,
    `/nbproject/private/ should match nbproject/private/; got ${result.matched.length} matched`);
});

test('matchComponent excludes negation patterns from ratio so they do not inflate the total', () => {
  // Negation patterns (!...) are contextual exemptions, not independent rules.
  // They are kept in matched/unmatched for coverage tracking but excluded from
  // the ratio denominator so a component with many negation refinements (e.g.
  // language/java, editor/vscode) does not have its match ratio deflated by
  // unmatched negation lines.
  //
  // Here the component has one positive rule (bin/) the user matches, plus a
  // negation rule (!**/src/main/**/bin/) the user does not have. Without the
  // fix, total would be 2, matched 1, ratio 0.5. With the fix, total is 1,
  // positiveMatched 1, ratio 1.0 (full). The negation line is still in
  // unmatched for coverage tracking.
  const result = matchComponent(['bin/'], 'bin/\n!**/src/main/**/bin/\n');
  assert.equal(result.matched.length, 1, 'positive rule should match');
  assert.equal(result.unmatched.length, 1, 'negation rule should be in unmatched for coverage tracking');
  assert.equal(result.total, 1, 'negation patterns should not count toward total');
  assert.equal(result.positiveMatched, 1, 'positiveMatched should count only positive matched lines');
  assert.equal(result.ratio, 1.0, 'ratio should be full when the only positive rule matches');
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

test('scorePreset penalizes only added rules, not input lines a none-match already covers', () => {
  // A "none"-classified component (ratio 0.25) whose one matched line is already
  // in the input. Only its 3 unmatched lines are genuinely "added"; the matched
  // line must not be penalized because it is already present in the .gitignore.
  const componentResults = new Map();
  componentResults.set('noise', { matched: ['a'], unmatched: ['b', 'c', 'd'], total: 4, ratio: 0.25 });

  const totalInputLines = 10;
  const score = scorePreset(['noise'], componentResults, totalInputLines);

  // Reconstruct the expected score using unmatched (3), not total (4), as the penalty.
  const WEIGHT_NONE = 0.25;
  const matchedLineCount = 1 * WEIGHT_NONE;
  const inputCoverage = matchedLineCount / totalInputLines;
  const completeness = 0; // no full matches
  const addedRuleCount = 3; // only unmatched lines are "added"
  const expected = Math.max(0, Math.round(
    inputCoverage * 400 + completeness * 150 + matchedLineCount * 25 - addedRuleCount * 2
  ));

  assert.equal(score.score, expected,
    'none-match penalty should count only unmatched (added) lines, not lines already in the input');
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

// --- #1: normalizePattern must trim whitespace for matching ---

test('normalizePattern trims whitespace, slashes, and globs so semantically equivalent patterns match', () => {
  const { normalizePattern } = require('../src/core/text');
  // Patterns with leading/trailing whitespace must normalize to the same key
  // as their trimmed form, so matching is not broken by whitespace differences.
  // Trailing slashes are also stripped because Git treats "dir/" and "dir"
  // identically for matching purposes.
  assert.equal(normalizePattern('  node_modules/'), 'node_modules',
    'leading whitespace must be trimmed');
  assert.equal(normalizePattern('node_modules/  '), 'node_modules',
    'trailing whitespace must be trimmed');
  assert.equal(normalizePattern('  node_modules/  '), 'node_modules',
    'both leading and trailing whitespace must be trimmed');
  assert.equal(normalizePattern('node_modules/'), 'node_modules',
    'trailing slash must be stripped');
  assert.equal(normalizePattern('node_modules'), 'node_modules',
    'already-normalized pattern is unchanged');
  // Leading slashes are stripped because "/pattern" and "pattern" are
  // semantically equivalent for matching (both ignore the same files;
  // the leading slash only anchors to root, which doesn't change coverage).
  assert.equal(normalizePattern('/nbproject/private/'), 'nbproject/private',
    'leading slash must be stripped');
  assert.equal(normalizePattern('/dist/'), 'dist',
    'leading slash on short pattern must be stripped');
  // Trailing "/*" is stripped because "dirname/*" and "dirname/" are
  // semantically equivalent for matching — both ignore everything inside
  // the directory. The "/*" form is used with negation rules, but the
  // parent pattern covers the same files.
  assert.equal(normalizePattern('.vscode/*'), '.vscode',
    'trailing /* must be stripped so .vscode/ matches .vscode/*');
  assert.equal(normalizePattern('.vscode/'), '.vscode',
    '.vscode/ and .vscode/* must normalize to the same key');
  assert.equal(normalizePattern('build/*'), 'build',
    'trailing /* on other patterns must be stripped');
  // Negation patterns: "!/pattern" and "!pattern" are semantically equivalent
  // for matching — the negation un-ignores the same files regardless of anchoring.
  // normalizePattern must strip the leading slash after the "!" prefix.
  assert.equal(normalizePattern('!/foo'), '!foo',
    'leading slash after ! must be stripped so !/foo matches !foo');
  assert.equal(normalizePattern('!/foo/'), '!foo',
    'leading slash and trailing slash after ! must both be stripped');
  assert.equal(normalizePattern('!foo'), '!foo',
    'negation without leading slash is unchanged');
  assert.equal(normalizePattern('!.vscode/*'), '!.vscode',
    'negation with trailing /* must strip both ! prefix slash and trailing /*');
});

test('matchComponent matches lines that differ only in leading/trailing whitespace', () => {
  // Input lines have trailing spaces; component content does not (or vice versa).
  // normalizePattern must make them match.
  const inputLines = ['node_modules/', '  dist/  ', '.env  '];
  const componentContent = 'node_modules/\ndist/\n.env\n';
  const result = matchComponent(inputLines, componentContent);
  assert.equal(result.matched.length, 3,
    `all 3 lines should match despite whitespace differences; got ${result.matched.length} matched, ${result.unmatched.length} unmatched`);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.ratio, 1.0);
});

test('analyze size guard uses byte length, not character length', () => {
  // A string of 600 KiB of ASCII characters is 600 KiB in both .length and
  // Buffer.byteLength(). But a string with multi-byte characters (e.g. CJK)
  // has .length < Buffer.byteLength() — a 400 KiB character string of 3-byte
  // UTF-8 characters is 1.2 MiB in bytes, exceeding the 1 MiB guard.
  // The size guard must measure bytes, not characters, to correctly reject
  // oversized content.
  const { analyzeGitignore } = require('../src/workflows/analyze');
  const workspace = createTempWorkspace();
  try {
    // 400,000 CJK characters: each is 3 bytes in UTF-8 = 1,200,000 bytes > 1 MiB.
    // .length is 400,000 which is < 1 MiB, so a character-based guard would
    // incorrectly allow this content through.
    const cjkContent = '一'.repeat(400000) + '\n';
    assert.ok(cjkContent.length < 1024 * 1024,
      `character length (${cjkContent.length}) must be under 1 MiB for the test to be valid`);
    assert.ok(Buffer.byteLength(cjkContent, 'utf8') > 1024 * 1024,
      `byte length (${Buffer.byteLength(cjkContent, 'utf8')}) must exceed 1 MiB for the test to be valid`);

    assert.throws(
      () => analyzeGitignore({
        gitignorePath: workspace.path('.gitignore'),
        distRoot: workspace.path('dist'),
        content: cjkContent
      }),
      /too large/
    );
  } finally {
    workspace.cleanup();
  }
});

// --- #3: runAnalyzeWorkflow must forward projectPath for signal detection ---

test('runAnalyzeWorkflow detects signals from project root when .gitignore is in a subdirectory', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/platform/macos.gitignore', '.DS_Store\n');
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/framework/vite.gitignore', 'dist/\n');
    workspace.writeJson('dist/presets/generic.json', { name: 'generic', components: ['platform/macos'] });
    workspace.writeJson('dist/presets/node.json', { name: 'node', base: 'generic', components: ['language/node'] });
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', base: 'node', components: ['framework/vite'] });
    // package.json is at the project root, but the .gitignore is in a subdirectory.
    workspace.writeJson('project/package.json', { scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } });
    workspace.writeText('project/subdir/.gitignore', '.DS_Store\n');

    let output = '';
    const result = runAnalyzeWorkflow({
      gitignorePath: workspace.path('project/subdir/.gitignore'),
      distRoot: workspace.path('dist'),
      suggestPreset: true,
      projectPath: workspace.path('project')
    }, { stdout: { write: text => { output += text; } }, cwd: workspace.root });

    // Signal detection must scan the project root (where package.json lives),
    // not the subdirectory containing the .gitignore.
    assert.equal(result.bestPreset.id, 'vite',
      'signal detection should find Vite from project root, not subdir');
    assert.match(output, /Vite detected in package.json/);
  } finally {
    workspace.cleanup();
  }
});
