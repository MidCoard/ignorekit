'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');

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
      '--user-root', fakeUserRoot,
      '--output-root', fakeUserRoot
    ], {
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