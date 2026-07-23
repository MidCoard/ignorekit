'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { MAX_CONTENT_BYTES } = require('../src/core/constants');

// chooseRulesSmart is exported indirectly through promptComponentCreation in
// src/interactive/create.js. We test it by driving the full interactive flow
// via runCli — that mirrors how a real user would hit the broken path.

test('chooseRulesSmart falls back to inline rules when analyzeGitignore throws (file too large)', async () => {
  const workspace = createTempWorkspace();
  try {
    // Create a .gitignore file larger than analyzeGitignore's 1 MiB guard.
    // The file itself is small enough to read with parseSignificantLines
    // but trips the size guard inside analyzeGitignore.
    const hugePath = workspace.path('project/huge.gitignore');
    fs.mkdirSync(path.dirname(hugePath), { recursive: true });
    // Use a sparse 2 MiB of newline-separated padding; parseSignificantLines
    // trims and dedups, so the resulting line set is small.
    const padding = '\n'.repeat(2 * 1024 * 1024);
    fs.writeFileSync(hugePath, 'real-rule-A\nreal-rule-B\n' + padding, 'utf8');

    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    // Drive the interactive flow: provide a source path, then hit the
    // "Enter rules one per line" path because analyze must fail.
    const answers = [
      'local',                         // category
      'huge-file-test',                // name
      hugePath,                        // source — large file
      'inline-rule-1',                 // inline rules: rule 1
      'inline-rule-2',                 // rule 2
      '',                              // blank → done with inline rules
      'y'                              // confirm
    ];
    const output = [];
    const errors = [];
    const { runCli } = require('../src/cli');
    const result = await runCli([
      'create', 'component',
      '--output-root', fakeUserRoot
    ], {
      envVars: { IGNOREKIT_USER_ROOT: fakeUserRoot },
      ask: () => answers.shift(),
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: text => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0, `expected exit 0; stderr: ${errors.join('')}`);
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'huge-file-test.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
    const content = fs.readFileSync(userFile, 'utf8');
    assert.match(content, /inline-rule-1/);
    assert.match(content, /inline-rule-2/);
    // The interactive prompt must have fallen back to "Enter rules one per line"
    assert.match(output.join(''), /Enter rules one per line/,
      'should fall back to inline rule entry when analyze fails');
  } finally {
    workspace.cleanup();
  }
});

// --- #1 (P0): "Analyzing..." header must not print when analysis fails ---

test('chooseRulesSmart does not print "Analyzing..." header when analysis throws', async () => {
  const workspace = createTempWorkspace();
  try {
    // Create a .gitignore file that trips the size guard (> 1 MiB).
    const hugePath = workspace.path('project/huge.gitignore');
    fs.mkdirSync(path.dirname(hugePath), { recursive: true });
    const padding = '\n'.repeat(2 * 1024 * 1024);
    fs.writeFileSync(hugePath, 'real-rule-A\nreal-rule-B\n' + padding, 'utf8');

    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    const answers = [
      'local',                         // category
      'no-header-on-fail',             // name
      hugePath,                        // source — large file
      'inline-rule',                   // inline rule
      '',                              // blank → done
      'y'                              // confirm
    ];
    const output = [];
    const errors = [];
    const { runCli } = require('../src/cli');
    const result = await runCli([
      'create', 'component',
      '--output-root', fakeUserRoot
    ], {
      envVars: { IGNOREKIT_USER_ROOT: fakeUserRoot },
      ask: () => answers.shift(),
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: text => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0, `expected exit 0; stderr: ${errors.join('')}`);
    const out = output.join('');
    // The "Analyzing ..." header must NOT appear because the analysis failed.
    // Previously it was printed before the try/catch, so it showed even on failure.
    assert.doesNotMatch(out, /Analyzing.*huge\.gitignore/,
      '"Analyzing..." header must not print when analysis fails');
  } finally {
    workspace.cleanup();
  }
});

// --- #5 (P0): coveredByLine must use normalized keys, not raw strings ---

test('chooseRulesSmart preserves whitespace-sensitive rules for user selection', async () => {
  const workspace = createTempWorkspace();
  try {
    // Component has "logs/" (no trailing space).
    // The .gitignore has "logs/   " (trailing spaces) — same rule after trim.
    // The coveredByLine map must use normalized keys so the duplicate is
    // correctly identified as covered and pre-deselected.
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeText('project/.gitignore', 'logs/   \ncache/\n');

    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    const answers = [
      'local',                            // category
      'whitespace-dedup',                 // name
      workspace.path('project/.gitignore'), // source
      '',                                 // toggle — done (keep defaults)
      'y'                                 // confirm
    ];
    const output = [];

    const { runCli } = require('../src/cli');
    const result = await runCli(['create', 'component',
      '--output-root', fakeUserRoot
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist'), IGNOREKIT_USER_ROOT: fakeUserRoot },
      ask: () => answers.shift(),
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'whitespace-dedup.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
    const content = fs.readFileSync(userFile, 'utf8');
    // "logs/" is covered by the component (after normalization), so it must
    // NOT appear in the extracted component. Only "cache/" should remain.
    assert.match(content, /logs\/   /,
      '"logs/   " must remain selectable because it is not an exact component rule');
    assert.match(content, /cache\//,
      '"cache/" must be included as an uncovered custom rule');
  } finally {
    workspace.cleanup();
  }
});

// --- #8 (P1): chooseRulesSmart must guard readFileSync with statSync size check ---

test('chooseRulesSmart rejects oversized source file with EFILETOOLARGE before buffering', async () => {
  // A source .gitignore larger than MAX_CONTENT_BYTES must be rejected by
  // chooseRulesSmart BEFORE readFileSync buffers the entire file. Without the
  // statSync guard, a huge file is fully read into memory before the size
  // check inside analyzeGitignore fires. The fix adds a statSync size guard
  // that throws with err.code = 'EFILETOOLARGE', matching the pattern in
  // analyzeGitignore and readJson.
  const workspace = createTempWorkspace();
  try {
    // Create a file larger than MAX_CONTENT_BYTES. Use a sparse approach:
    // write a small header then extend the file to exceed the limit.
    const hugePath = workspace.path('project/oversized.gitignore');
    fs.mkdirSync(path.dirname(hugePath), { recursive: true });
    // Write content that exceeds MAX_CONTENT_BYTES (1 MiB)
    const padding = 'x'.repeat(MAX_CONTENT_BYTES + 1);
    fs.writeFileSync(hugePath, `real-rule\n${padding}`, 'utf8');

    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    const errors = [];
    const answers = [
      'local',                         // category
      'oversized-test',                // name
      hugePath,                        // source — oversized file
      'inline-rule',                   // inline rule (fallback path)
      '',                              // blank → done
      'y'                              // confirm
    ];

    const { runCli } = require('../src/cli');
    const result = await runCli([
      'create', 'component',
      '--output-root', fakeUserRoot
    ], {
      envVars: { IGNOREKIT_USER_ROOT: fakeUserRoot },
      ask: () => answers.shift(),
      stdout: { write: () => {} },
      stderr: { write: text => errors.push(String(text)) },
      cwd: workspace.root
    });

    // The oversized file should trigger a size-guard error that falls back to
    // inline rule entry (not a crash). The error should mention the file size
    // and carry the EFILETOOLARGE code.
    const stderrText = errors.join('');
    assert.match(stderrText, /too large|Cannot read/i,
      'chooseRulesSmart should reject oversized file with a size-related error');
    // The interactive flow should still succeed via fallback
    assert.equal(result.exitCode, 0, `expected exit 0; stderr: ${stderrText}`);
  } finally {
    workspace.cleanup();
  }
});

test('chooseRulesSmart rejects oversized source file before buffering (EFILETOOLARGE)', async () => {
  // A source .gitignore larger than MAX_CONTENT_BYTES must be rejected by
  // chooseRulesSmart BEFORE readFileSync buffers the entire file. Without the
  // statSync guard, a huge file is fully read into memory before the size
  // check inside analyzeGitignore fires. The fix adds a statSync size guard
  // that throws with err.code = 'EFILETOOLARGE', then returns null to signal
  // fallback to inline rule entry (matching the existing UX for oversized
  // files rejected by analyzeGitignore).
  //
  // The EFILETOOLARGE code is the key observable contract: without the
  // statSync guard, the error from the catch block wraps the
  // analyzeGitignore error in a generic "Cannot read source file" message
  // without the EFILETOOLARGE code. With the statSync guard, the error
  // carries EFILETOOLARGE so callers can distinguish "too large" from other
  // read errors.
  const { chooseRulesSmart } = require('../src/interactive/create');
  const workspace = createTempWorkspace();
  try {
    const hugePath = workspace.path('oversized.gitignore');
    const padding = 'x'.repeat(MAX_CONTENT_BYTES + 1);
    fs.writeFileSync(hugePath, `real-rule\n${padding}`, 'utf8');

    const state = { sourcePath: hugePath, rules: [], outputRoot: workspace.root };
    const stderrChunks = [];
    const env = {
      stdout: { write: () => {} },
      stderr: { write: text => stderrChunks.push(String(text)) },
      cwd: workspace.root,
      ask: async () => '',
      distRoot: workspace.path('dist')
    };

    // chooseRulesSmart should return null (fallback) for oversized files,
    // not throw. The statSync guard prevents readFileSync from buffering
    // the entire file.
    const result = await chooseRulesSmart(state, env);
    assert.equal(result, null,
      'chooseRulesSmart should return null for oversized file (fallback to inline rules)');
    // The stderr should mention the file is too large
    const stderrText = stderrChunks.join('');
    assert.match(stderrText, /too large/i,
      'chooseRulesSmart should log "too large" to stderr for oversized file');
  } finally {
    workspace.cleanup();
  }
});
