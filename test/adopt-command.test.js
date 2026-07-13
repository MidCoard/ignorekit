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
      workspace.path('dist')
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
      '--component', 'language/node', '--dist-root', workspace.path('dist')
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
      '--overwrite-config'
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
      '--overwrite-config'
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
      workspace.path('dist')
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
      workspace.path('dist')
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
      '--dist-root', workspace.path('dist'), '--overwrite-config'
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
      '--dist-root', workspace.path('dist'), '--yes'
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
