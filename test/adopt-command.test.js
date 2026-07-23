'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { runAdoptWorkflow } = require('../src/workflows/adopt');
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
      'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
  } finally {
    workspace.cleanup();
  }
});

test('adopt --dry-run never creates config or replaces .gitignore', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'keep-this-content\n');

    const output = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo', '--dry-run'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), false);
    assert.equal(workspace.readText('project/.gitignore'), 'keep-this-content\n');
    assert.match(output.join(''), /Dry run/);
  } finally {
    workspace.cleanup();
  }
});

test('adopt skips --remove-cached when the generated .gitignore is declined', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'keep-this-content\n');

    const output = [];
    const result = await runAdoptWorkflow({
      projectPath: workspace.path('project'),
      preset: 'demo',
      distRoot: workspace.path('dist'),
      removeCached: true
    }, {
      cwd: workspace.root,
      stdout: { write: text => output.push(String(text)) },
      ask: async () => 'n',
      confirm: async () => false
    });

    assert.equal(result.cachedRemoval.action, 'skipped');
    assert.match(output.join(''), /Skipped --remove-cached/);
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
      '--component', 'language/node'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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
      '--overwrite-config'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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
      'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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

test('adopt asks to overwrite config when it exists without --overwrite-config', async () => {
  // When an ignorekit.json already exists and --overwrite-config is NOT passed,
  // adopt asks the user interactively whether to overwrite. If the user says
  // no, the command exits without writing. If the user says yes, it proceeds.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    const existingConfig = { version: 1, name: 'existing', components: ['local/logs'] };
    workspace.writeJson('project/ignorekit.json', existingConfig);
    const originalConfigBytes = fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8');
    workspace.writeText('project/.gitignore', 'old-rule\n');
    const originalGitignoreBytes = fs.readFileSync(workspace.path('project/.gitignore'), 'utf8');

    // User declines the overwrite question
    const answers = ['n'];
    let answerIndex = 0;
    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      ask: (prompt) => answers[answerIndex++],
      stdin: { isTTY: true },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1, 'should exit 1 when user declines overwrite');
    // Original config + .gitignore must be byte-identical — no partial writes.
    assert.equal(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'), originalConfigBytes,
      'existing config must be unchanged when user declines overwrite');
    assert.equal(fs.readFileSync(workspace.path('project/.gitignore'), 'utf8'), originalGitignoreBytes,
      'existing .gitignore must be unchanged when user declines overwrite');
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
      '--overwrite-config'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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

test('adopt --remove-cached --dry-run does not inspect or change the Git index', async () => {
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
        dryRun: true,
        apply: true
      }, {
        cwd: workspace.root,
        stdout: { write: (text) => writes.push(String(text)) }
      });

      const output = writes.join('');
      assert.doesNotMatch(output, /secret\.key/);
      assert.doesNotMatch(output, /debug\.log/);
      assert.match(output, /Dry run/);
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

test('adopt --remove-cached works without --apply (apply is always implied)', async () => {
  // Verify that --remove-cached without --apply does NOT produce a "requires
  // --apply" error. The actual --remove-cached behavior (git ls-files) is
  // tested separately with real git repos — here we just confirm the
  // --apply guard is gone.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const errors = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    // No "requires --apply" error — that check was removed
    assert.doesNotMatch(errors.join(''), /requires --apply/,
      '--remove-cached without --apply must not produce a "requires --apply" error');
  } finally {
    workspace.cleanup();
  }
});

test('adopt overwrites .gitignore directly without creating a backup', async () => {
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
      'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);

    // .gitignore should be overwritten with the new content
    const gitignore = workspace.readText('project/.gitignore');
    assert.match(gitignore, /logs\//);
    assert.match(gitignore, /Generated by ignorekit/);
    // No .gitignore.bak should be created — backup feature removed
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.bak')), false,
      'adopt must not create .gitignore.bak');
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
      'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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
      'adopt', workspace.path('project'), '--preset', 'p'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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
      'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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
      '--overwrite-config'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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

// --- #3 (P0): adopt always writes after confirm ---

test('adopt preserves custom rules that differ in whitespace', async () => {
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
      '--overwrite-config'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    // The whitespace-duplicate "node_modules/" must appear only once in custom.
    assert.ok(config.custom.includes('node_modules/'));
    assert.ok(config.custom.includes('node_modules/   '));
    // The genuinely distinct rule must also be present.
    assert.ok(config.custom.some(r => r.trim() === 'custom-rule/'),
      `expected 'custom-rule/' in custom, got: ${JSON.stringify(config.custom)}`);
  } finally {
    workspace.cleanup();
  }
});

test('adopt keeps whitespace-sensitive rules that a component does not exactly cover', async () => {
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
      '--overwrite-config'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    // "logs/" is covered by the component — must NOT appear in custom.
    assert.ok(config.custom.includes('logs/   '),
      `'logs/   ' should be preserved as custom; got: ${JSON.stringify(config.custom)}`);
    // The genuinely custom rule must be present.
    assert.ok(config.custom.some(r => r.trim() === 'custom-rule/'),
      `expected 'custom-rule/' in custom, got: ${JSON.stringify(config.custom)}`);
  } finally {
    workspace.cleanup();
  }
});

test('adopt skips the confirmation prompt and writes the file', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    // A confirm() that always returns false would normally cancel adopt. The
    // workflow must bypass confirm and write anyway. We confirm by wiring a
    // confirm() in env — env.confirm overrides the CLI's confirm behavior,
    // so the test asserts that calling adopt succeeds even though our injected
    // env-confirm is hostile.
    const output = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: (s) => output.push(String(s)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });
    assert.equal(result.exitCode, 0,
      `expected exit 0, got ${result.exitCode}; output: ${output.join('')}`);
    assert.ok(fs.existsSync(workspace.path('project/ignorekit.json')),
      'config should have been written');
    assert.match(output.join(''), /Adopted/, 'should print Adopted summary');
    // Sanity: the prompt should NOT have been written.
    assert.doesNotMatch(output.join(''), /Proceed\?/,
      'should not show the Proceed? prompt');
  } finally {
    workspace.cleanup();
  }
});

// --- #2: adopt always writes after confirm ---

test('adopt writes files in non-interactive mode', async () => {
  // Without env.ask, adopt writes directly in non-interactive mode.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const output = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: (s) => output.push(String(s)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    // Files should be written
    assert.ok(fs.existsSync(workspace.path('project/ignorekit.json')),
      'config should be written');
    // The .gitignore should be updated
    const gitignore = workspace.readText('project/.gitignore');
    assert.match(gitignore, /logs\//);
    // No preview shown in non-interactive mode without --preview flag
    const out = output.join('');
    assert.doesNotMatch(out, /--- Preview/,
      'preview should not be shown in non-interactive mode without --preview');
  } finally {
    workspace.cleanup();
  }
});

// --- #6 (P1): --exclude must filter preset components from selectedComponentIds ---

test('adopt --exclude prevents excluded component rules from being treated as covered', async () => {
  // When a component is excluded via --exclude, its rules should NOT be
  // considered "covered" by the preset. Without the fix, excluded components'
  // rules were added to coveredRules, so custom rules matching those components
  // were silently dropped from config.custom.
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/platform/macos.gitignore', '.DS_Store\n');
    workspace.writeText('dist/components/platform/windows.gitignore', 'Thumbs.db\n');
    workspace.writeJson('dist/presets/generic.json', {
      name: 'generic',
      components: ['platform/macos', 'platform/windows']
    });
    // .gitignore has both macos and windows rules, plus a custom rule
    workspace.writeText('project/.gitignore', '.DS_Store\nThumbs.db\ncustom-rule/\n');

    // Exclude platform/windows — its rules should NOT be covered
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'generic',
      '--exclude', 'platform/windows',
      '--overwrite-config'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    // Thumbs.db must be in custom (windows was excluded, so its rule is not covered)
    assert.ok(config.custom.some(r => r.trim() === 'Thumbs.db'),
      `Thumbs.db should be in custom since platform/windows was excluded; got: ${JSON.stringify(config.custom)}`);
    // .DS_Store should NOT be in custom (platform/macos is still included)
    assert.ok(!config.custom.some(r => r.trim() === '.DS_Store'),
      `.DS_Store should be covered by platform/macos; got: ${JSON.stringify(config.custom)}`);
    // custom-rule should be in custom
    assert.ok(config.custom.some(r => r.trim() === 'custom-rule/'),
      `custom-rule/ should be in custom; got: ${JSON.stringify(config.custom)}`);
  } finally {
    workspace.cleanup();
  }
});

// --- #7 (P1): extra components with zero overlap must be accounted for in coveredRules ---

test('adopt carries forward rules from extra components that have zero overlap with existing .gitignore', async () => {
  // When an extra component (--component) has zero matched lines in the
  // analysis, its rules were not added to coveredRules, causing them to be
  // duplicated in the generated .gitignore (once from the component, once
  // from config.custom).
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n*.log\n');
    workspace.writeText('dist/components/local/secrets.gitignore', '.env\n*.pem\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // .gitignore has logs rules and secrets rules
    workspace.writeText('project/.gitignore', 'logs/\n*.log\n.env\n*.pem\ncustom-rule/\n');

    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo',
      '--component', 'local/secrets',
      '--overwrite-config'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const config = JSON.parse(fs.readFileSync(workspace.path('project/ignorekit.json'), 'utf8'));
    // .env and *.pem should NOT be in custom — they are covered by local/secrets
    assert.ok(!config.custom.some(r => r.trim() === '.env'),
      `.env should be covered by local/secrets; got: ${JSON.stringify(config.custom)}`);
    assert.ok(!config.custom.some(r => r.trim() === '*.pem'),
      `*.pem should be covered by local/secrets; got: ${JSON.stringify(config.custom)}`);
    // custom-rule should be in custom
    assert.ok(config.custom.some(r => r.trim() === 'custom-rule/'),
      `custom-rule/ should be in custom; got: ${JSON.stringify(config.custom)}`);
  } finally {
    workspace.cleanup();
  }
});

// --- #8 (P1): analysis failure must warn about custom rules being lost ---

test('adopt warns when analysis fails and .gitignore exists', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    // Create a .gitignore larger than the 1 MiB guard to trigger analysis failure
    const padding = '\n'.repeat(2 * 1024 * 1024);
    workspace.writeText('project/.gitignore', 'logs/\ncustom-rule/\n' + padding);

    const errors = [];
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0, `expected exit 0; stderr: ${errors.join('')}`);
    // Must warn that custom rules will not be carried forward
    assert.match(errors.join(''), /custom rules will NOT be carried forward/i,
      'should warn about custom rules being lost when analysis fails');
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
      'adopt', workspace.path('project'), '--preset', 'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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

test('adopt writes config and .gitignore', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(workspace.path('project/ignorekit.json')),
      'config must be written');
    const gitignore = workspace.readText('project/.gitignore');
    assert.match(gitignore, /Generated by ignorekit/);
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
      'adopt', workspace.path('project'), '--preset', 'nonexistent'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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
      'adopt', workspace.path('project'), '--preset', 'missing-preset'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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
  // "Custom rules") and BEFORE the preview ("--- Preview (.gitignore) ---").
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
      'adopt', workspace.path('project'), '--preset', 'nonexistent-preset'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: text => stdoutLines.push(String(text)) },
      stderr: { write: text => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1, 'must fail when preset does not exist');
    const out = stdoutLines.join('');
    // The preset validation must fire before any analysis or preview output.
    assert.doesNotMatch(out, /Analyzing existing/,
      'must not show analysis output for an invalid preset');
    assert.doesNotMatch(out, /--- Preview/,
      'must not show preview for an invalid preset');
    assert.doesNotMatch(out, /Preset "nonexistent-preset" will add/,
      'must not show preset-vs-analysis output for an invalid preset');
    assert.match(errors.join(''), /nonexistent-preset/,
      'error must identify the missing preset');
  } finally {
    workspace.cleanup();
  }
});

// --- Interactive extra component selection ---

test('adopt with lost components shows interactive picker and adds selected components', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeText('dist/components/local/env-secrets.gitignore', '.env\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'logs/\n.env\ncustom-rule/\n');

    const outputs = [];
    // Simulate user pressing Enter to accept defaults (full matches pre-selected),
    // then confirming, then declining preview
    const answers = ['', 'y', 'n'];  // component picker, confirm, preview
    let answerIndex = 0;
    const result = await runCli([
      'adopt', workspace.path('project'), '--preset', 'demo'
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: (text) => outputs.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root,
      ask: async (prompt) => answers[answerIndex++] || '',
      stdin: { isTTY: () => true }
    });

    const out = outputs.join('');
    // The interactive picker should show the component list
    assert.match(out, /local\/env-secrets.*✓ full/);
    // Full matches should be added
    assert.match(out, /Added.*extra component.*local\/env-secrets/);
  } finally {
    workspace.cleanup();
  }
});

test('pickExtraComponents auto-adds full matches in non-interactive mode', async () => {
  const { pickExtraComponents } = require('../src/interactive/create');
  const lostComponents = [
    { id: 'local/ai-claude', classification: 'full', matched: [1], total: 1 },
    { id: 'local/ai-codegraph', classification: 'full', matched: [1], total: 1 },
    { id: 'language/python', classification: 'partial', matched: [1, 2, 3], total: 8 }
  ];
  // No env.ask → non-interactive mode
  const selected = await pickExtraComponents(lostComponents, {
    stdout: { write: () => {} },
    stderr: { write: () => {} }
  });
  assert.deepEqual(selected, ['local/ai-claude', 'local/ai-codegraph'],
    'only full matches auto-added in non-interactive mode');
});
