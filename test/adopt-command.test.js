'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('adopt with --preset skips interactive picker', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist'),
      '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
  } finally {
    workspace.cleanup();
  }
});

test('adopt keeps explicit extra components and avoids duplicating selected preset rules as custom', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/language/java.gitignore', [
      '*.class', 'out/', 'bin/', '.settings/', '.classpath', '.project'
    ].join('\n') + '\n');
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n.vite/\n');
    workspace.writeJson('dist/presets/java.json', { name: 'java', components: ['language/java'] });
    workspace.writeText('project/.gitignore', '*.class\nnode_modules/\n.vite/\nproject-private/\n');

    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'java',
      '--component', 'language/node', '--dist-root', workspace.path('dist'), '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(workspace.readText('project/ignorekit.json'));
    assert.deepEqual(config.components, ['language/node']);
    assert.deepEqual(config.custom, ['project-private/']);
  } finally {
    workspace.cleanup();
  }
});

test('adopt defaults path to current directory', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist'),
      '--overwrite-config',
      '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('ignorekit.json')), true);
  } finally {
    workspace.cleanup();
  }
});

test('adopt refuses to overwrite existing config without --overwrite-config', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeJson('project/ignorekit.json', { version: 1, name: 'existing' });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const errors = [];
    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /Config already exists/);
  } finally {
    workspace.cleanup();
  }
});

test('adopt fails before analysis/preview when config exists without --overwrite-config', async () => {
  // The overwrite-guard must fire BEFORE the analysis step. Otherwise a user
  // who already has a config in place sees "Rules needing review" output and
  // a "Preset will add N components" preview before learning their config
  // blocks the write entirely. Verify (a) no analysis output is printed,
  // (b) no confirm prompt is issued even when env.ask would drive one,
  // (c) exit code 1, (d) the original config is byte-identical, and
  // (e) no .gitignore.bak file was created.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    const existingConfig = { version: 1, name: 'existing', components: ['local/logs'] };
    workspace.writeJson('project/ignorekit.json', existingConfig);
    const originalConfigBytes = fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8');
    workspace.writeText('project/.gitignore', 'old-rule\n');
    const originalGitignoreBytes = fs.readFileSync(workspace.path('project/.gitignore'), 'utf8');

    let askCalled = false;
    const stdoutLines = [];
    const stderrLines = [];
    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist')
    ], {
      // Drive any confirm prompt with a "yes" answer. If the guard fires
      // BEFORE the confirm, ask() must never be called.
      ask: () => { askCalled = true; return 'y'; },
      stdin: { isTTY: true },
      stdout: { write: (text) => stdoutLines.push(String(text)) },
      stderr: { write: (text) => stderrLines.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1, `expected exit 1; stderr: ${stderrLines.join('')}`);
    // Guard must fire BEFORE analysis — no "Rules needing review" or
    // "Preset will add" output should appear.
    const out = stdoutLines.join('');
    assert.doesNotMatch(out, /Rules needing review/,
      'adopt must not print analysis output when the config-overwrite guard will reject');
    assert.doesNotMatch(out, /Preset "demo" will add/,
      'adopt must not print preset-vs-analysis output when the config-overwrite guard will reject');
    assert.doesNotMatch(out, /--- Preview ---/,
      'adopt must not show a preview when the config-overwrite guard will reject');
    assert.equal(askCalled, false,
      'adopt must not issue the confirm prompt when the config-overwrite guard will reject');
    // Guard must prevent any bak-file creation.
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.bak')), false,
      'adopt must not create .gitignore.bak when config guard rejects early');
    // Original config + .gitignore must be byte-identical — no partial writes.
    assert.equal(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'), originalConfigBytes,
      'existing config must be unchanged when adopt refuses to overwrite');
    assert.equal(fs.readFileSync(workspace.path('project/.gitignore'), 'utf8'), originalGitignoreBytes,
      'existing .gitignore must be unchanged when adopt refuses to overwrite');
  } finally {
    workspace.cleanup();
  }
});

test('adopt with --overwrite-config replaces existing config', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeJson('project/ignorekit.json', { version: 1, name: 'existing' });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist'),
      '--overwrite-config',
      '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(workspace.readText('project/ignorekit.json'));
    assert.equal(config.name, 'project');
  } finally {
    workspace.cleanup();
  }
});

test('adopt --remove-cached dry-run prints file list to stdout', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    // Clear require cache so adopt picks up mocked git
    delete require.cache[require.resolve('../src/workflows/adopt')];
    delete require.cache[require.resolve('../src/git')];

    const git = require('../src/git');
    const origList = git.listTrackedIgnoredFiles;
    const origRemove = git.removeCachedFiles;
    git.listTrackedIgnoredFiles = () => ['secret.key', 'debug.log'];
    git.removeCachedFiles = (_projectPath, files, opts) => {
      return { action: 'dry-run', files };
    };

    const { runAdoptWorkflow } = require('../src/workflows/adopt');

    const writes = [];
    try {
      await runAdoptWorkflow({
        projectPath: workspace.path('project'),
        preset: 'demo',
        distRoot: workspace.path('dist'),
        removeCached: true,
        apply: true
      }, {
        cwd: workspace.root,
        stdout: { write: (text) => writes.push(String(text)) }
      });

      const output = writes.join('');
      assert.match(output, /secret\.key/);
      assert.match(output, /debug\.log/);
    } finally {
      git.listTrackedIgnoredFiles = origList;
      git.removeCachedFiles = origRemove;
      delete require.cache[require.resolve('../src/workflows/adopt')];
      delete require.cache[require.resolve('../src/git')];
    }
  } finally {
    workspace.cleanup();
  }
});

test('adopt refuses cached removal until the generated ignore file is applied', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const errors = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo', '--remove-cached', '--yes',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /requires --apply/);
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false);
  } finally {
    workspace.cleanup();
  }
});

test('adopt overwrites .gitignore directly and saves backup of original', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Existing .gitignore
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist'),
      '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);

    // .gitignore should be overwritten with the new content
    const gitignore = workspace.readText('project/.gitignore');
    assert.match(gitignore, /logs\//);
    assert.match(gitignore, /Generated by ignorekit/);
    // The original file content lives in the backup now
    assert.equal(workspace.readText('project/.gitignore.bak'), 'old-rule\n');

    // .gitignore.bak should contain the original content
    const backup = workspace.readText('project/.gitignore.bak');
    assert.equal(backup, 'old-rule\n');
  } finally {
    workspace.cleanup();
  }
});

test('adopt does not create .gitignore.preview file', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    // No .gitignore.preview file should be created — preview is console-only
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.preview')), false,
      '.gitignore.preview file should not be created');
  } finally {
    workspace.cleanup();
  }
});

test('adopt lists a preset component as new when the current .gitignore only partly covers it (>=80% but not all)', async () => {
  const workspace = createTempWorkspace();
  try {
    // 5-rule component: 4 present in the .gitignore → ratio 0.8 → classified 'full'
    // even though one rule (e5) is missing and the preset WILL add it.
    workspace.writeText('dist/components/x/near.gitignore', 'e1\ne2\ne3\ne4\ne5\n');
    workspace.writeJson('dist/presets/p.json', { name: 'p', components: ['x/near'] });
    workspace.writeText('project/.gitignore', 'e1\ne2\ne3\ne4\n');

    const writes = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'p',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: text => writes.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const output = writes.join('');
    // The component is not fully present (e5 is added by the preset), so it must
    // be surfaced as a new/added component rather than silently treated as covered.
    assert.match(output, /will add 1 new component/);
    assert.match(output, /x\/near/);
  } finally {
    workspace.cleanup();
  }
});

test('adopt creates .gitignore directly when none existed', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Create the project directory but no .gitignore
    workspace.writeText('project/.gitkeep', '');

    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist'),
      '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);

    // .gitignore should exist
    assert.ok(fs.existsSync(workspace.path('project/.gitignore')), '.gitignore should be created');
    assert.match(workspace.readText('project/.gitignore'), /logs\//);

    // No .gitignore.preview file
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.preview')), false);
  } finally {
    workspace.cleanup();
  }
});

// --- #9 (Adv): adopt must carry forward rules with original whitespace ---

test('adopt preserves the source byte text of custom rules (trailing whitespace, quoting)', async () => {
  const workspace = createTempWorkspace();
  try {
    // No known components match these patterns. preserve-trailing-space and
    // backslash-hash are intentionally odd so that any normalization in
    // adopt's carry-forward logic would be visible in the output.
    workspace.writeJson('dist/presets/empty.json', { name: 'empty', components: [] });
    workspace.writeText('project/.gitignore', 'normal-rule\nwith-trailing-space   \n\\#literal-comment\n');

    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'empty',
      '--dist-root', workspace.path('dist'), '--overwrite-config', '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    assert.ok(Array.isArray(config.custom), 'custom field should be an array');
    // All three rules must round-trip verbatim — including the trailing
    // whitespace and the literal "\#" which gitignore treats as a
    // non-comment escape.
    assert.ok(config.custom.includes('normal-rule'), `expected 'normal-rule' in custom, got: ${JSON.stringify(config.custom)}`);
    assert.ok(config.custom.includes('with-trailing-space   '), `expected trailing whitespace preserved, got: ${JSON.stringify(config.custom)}`);
    assert.ok(config.custom.includes('\\#literal-comment'), `expected backslash-hash preserved, got: ${JSON.stringify(config.custom)}`);
  } finally {
    workspace.cleanup();
  }
});

// --- #3 (P0): adopt --yes must skip the post-preview confirm prompt ---

test('adopt deduplicates custom rules that differ only in whitespace (#5)', async () => {
  const workspace = createTempWorkspace();
  try {
    // A .gitignore with the same rule appearing twice — once with trailing
    // whitespace, once without. The dedup must treat them as the same rule
    // and keep only one copy (preserving the original byte text of the first
    // occurrence).
    workspace.writeJson('dist/presets/empty.json', { name: 'empty', components: [] });
    workspace.writeText('project/.gitignore', 'node_modules/\nnode_modules/   \ncustom-rule/\n');

    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'empty',
      '--dist-root', workspace.path('dist'), '--overwrite-config', '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    // The whitespace-duplicate "node_modules/" must appear only once in custom.
    const nodeCount = config.custom.filter(r => r.trim() === 'node_modules/').length;
    assert.equal(nodeCount, 1,
      `expected exactly 1 'node_modules/' entry in custom, got ${nodeCount}: ${JSON.stringify(config.custom)}`);
    // The genuinely distinct rule must also be present.
    assert.ok(config.custom.some(r => r.trim() === 'custom-rule/'),
      `expected 'custom-rule/' in custom, got: ${JSON.stringify(config.custom)}`);
  } finally {
    workspace.cleanup();
  }
});

test('adopt recognizes covered rules despite whitespace mismatch (#6)', async () => {
  const workspace = createTempWorkspace();
  try {
    // The component file has "logs/" without trailing whitespace.
    // The .gitignore has "logs/   " with trailing whitespace.
    // adopt must recognize the rule as covered and NOT carry it forward as custom.
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'logs/   \ncustom-rule/\n');

    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo',
      '--dist-root', workspace.path('dist'), '--overwrite-config', '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    // "logs/" is covered by the component — must NOT appear in custom.
    assert.ok(!config.custom.some(r => r.trim() === 'logs/'),
      `'logs/' should be covered, not custom; got: ${JSON.stringify(config.custom)}`);
    // The genuinely custom rule must be present.
    assert.ok(config.custom.some(r => r.trim() === 'custom-rule/'),
      `expected 'custom-rule/' in custom, got: ${JSON.stringify(config.custom)}`);
  } finally {
    workspace.cleanup();
  }
});

test('adopt --yes skips the confirmation prompt and writes the file', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    // A confirm() that always returns false would normally cancel adopt. With
    // --yes the workflow must bypass confirm and write anyway. We confirm by
    // wiring a confirm() in env — env.confirm overrides the CLI's confirm
    // behavior and the buildCreateEnv honors the --yes flag, so the test
    // asserts that calling adopt WITH --yes succeeds even though our injected
    // env-confirm is hostile.
    const output = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo',
      '--dist-root', workspace.path('dist'), '--yes', '--apply'
    ], {
      stdout: { write: (s) => output.push(String(s)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });
    assert.equal(result.exitCode, 0,
      `expected exit 0 with --yes, got ${result.exitCode}; output: ${output.join('')}`);
    assert.ok(fs.existsSync(workspace.path('project/ignorekit.json')),
      'config should have been written with --yes');
    assert.match(output.join(''), /Adopted/, 'should print Adopted summary');
    // Sanity: the prompt should NOT have been written when --yes is set.
    assert.doesNotMatch(output.join(''), /Proceed\?/,
      '--yes should not show the Proceed? prompt');
  } finally {
    workspace.cleanup();
  }
});

// --- #2: adopt must not write files without --apply ---

test('adopt without --apply shows preview but does not write files', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const output = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: (s) => output.push(String(s)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const out = output.join('');
    // Preview must be shown
    assert.match(out, /--- Preview ---/);
    // But no files should be written
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false,
      'config must not be written without --apply');
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.bak')), false,
      'backup must not be created without --apply');
    // The original .gitignore must be unchanged
    assert.equal(workspace.readText('project/.gitignore'), 'old-rule\n',
      'original .gitignore must be unchanged without --apply');
  } finally {
    workspace.cleanup();
  }
});

// --- #2 (P1): adopt must guard analyzeGitignore against oversized files ---

test('adopt degrades gracefully when .gitignore is too large to analyze', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Create a .gitignore larger than the 1 MiB guard.
    const padding = '\n'.repeat(2 * 1024 * 1024);
    workspace.writeText('project/.gitignore', 'logs/\n' + padding);

    const errors = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo',
      '--dist-root', workspace.path('dist'), '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    // Must not crash — adopt should proceed without analysis.
    assert.equal(result.exitCode, 0, `expected exit 0; stderr: ${errors.join('')}`);
    // A warning about the analysis failure should appear on stderr.
    assert.match(errors.join(''), /too large|Could not analyze/,
      'should warn about analysis failure on stderr');
    // Config and .gitignore must still be written.
    assert.ok(fs.existsSync(workspace.path('project/ignorekit.json')),
      'config must be written even when analysis fails');
  } finally {
    workspace.cleanup();
  }
});

test('adopt with --apply writes config and .gitignore', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo',
      '--dist-root', workspace.path('dist'), '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(workspace.path('project/ignorekit.json')),
      'config must be written with --apply');
    assert.ok(fs.existsSync(workspace.path('project/.gitignore.bak')),
      'backup must be created with --apply when .gitignore exists');
    const gitignore = workspace.readText('project/.gitignore');
    assert.match(gitignore, /Generated by ignorekit/);
  } finally {
    workspace.cleanup();
  }
});

test('adopt skips backup when .gitignore.bak already exists and preserves the original backup', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Pre-existing .gitignore and a prior backup
    workspace.writeText('project/.gitignore', 'old-rule\n');
    workspace.writeText('project/.gitignore.bak', 'original-backup-content\n');

    const output = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo',
      '--dist-root', workspace.path('dist'), '--apply'
    ], {
      stdout: { write: (s) => output.push(String(s)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    // The original backup must be preserved, not overwritten
    assert.equal(workspace.readText('project/.gitignore.bak'), 'original-backup-content\n',
      'existing .gitignore.bak must not be overwritten');
    // A warning about skipping the backup should appear
    assert.match(output.join(''), /Skipping backup.*already exists/);
  } finally {
    workspace.cleanup();
  }
});

// --- #3 (P0): adopt must propagate resolvePresetComponents errors instead of
//     silently swallowing them and writing wrong custom rules ---

test('adopt propagates preset-not-found error from analysis comparison (no silent swallow)', async () => {
  // When the preset does not exist, the adopt workflow used to catch the
  // resolvePresetComponents error in the analysis comparison block and
  // silently continue — then later the generator would also silently skip
  // the missing preset, producing a .gitignore with no preset content.
  // The catch block must be removed so the error propagates immediately.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    // No preset file for 'nonexistent' — resolvePresetComponents must throw
    workspace.writeText('project/.gitignore', 'logs/\ncustom-rule/\n');

    const errors = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'nonexistent',
      '--dist-root', workspace.path('dist'), '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1, 'adopt must fail when preset does not exist');
    assert.match(errors.join(''), /Unknown preset.*nonexistent|nonexistent/,
      'error must mention the missing preset');
  } finally {
    workspace.cleanup();
  }
});

test('adopt with nonexistent preset errors immediately without writing files', async () => {
  // A nonexistent preset must error before any config or .gitignore is written.
  // Previously the two catch blocks let the workflow continue past the
  // resolution errors and write a config with an invalid preset name.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeText('project/.gitignore', 'logs/\ncustom-rule/\n');

    const errors = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'missing-preset',
      '--dist-root', workspace.path('dist'), '--apply'
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1, 'must fail when preset is missing');
    // No config or .gitignore should be written
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false,
      'config must not be written when preset resolution fails');
    assert.match(errors.join(''), /Unknown preset.*missing-preset|missing-preset/,
      'error must identify the missing preset');
  } finally {
    workspace.cleanup();
  }
});

test('adopt validates preset before showing analysis or preview output', async () => {
  // When a nonexistent preset is used with an existing .gitignore, the error
  // must fire BEFORE the analysis output ("Analyzing existing .gitignore",
  // "Rules needing review") and BEFORE the preview ("--- Preview ---").
  // Showing analysis/preview for a preset that will ultimately fail is
  // misleading — the user sees "Preset will add N components" only to learn
  // the preset doesn't exist.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeText('project/.gitignore', 'logs/\ncustom-rule/\n');

    const stdoutLines = [];
    const errors = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'nonexistent-preset',
      '--dist-root', workspace.path('dist')
    ], {
      stdout: { write: text => stdoutLines.push(String(text)) },
      stderr: { write: text => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1, 'must fail when preset does not exist');
    const out = stdoutLines.join('');
    // The preset validation must fire before any analysis or preview output.
    assert.doesNotMatch(out, /Analyzing existing/,
      'must not show analysis output for an invalid preset');
    assert.doesNotMatch(out, /--- Preview ---/,
      'must not show preview for an invalid preset');
    assert.doesNotMatch(out, /Preset "nonexistent-preset" will add/,
      'must not show preset-vs-analysis output for an invalid preset');
    assert.match(errors.join(''), /nonexistent-preset/,
      'error must identify the missing preset');
  } finally {
    workspace.cleanup();
  }
});
