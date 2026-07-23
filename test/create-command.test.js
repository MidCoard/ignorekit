'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { promptComponentCreation, promptPresetCreation } = require('../src/interactive/create');
const { createTempWorkspace } = require('./helpers/temp-workspace');

/**
 * Track files written to the real USER_ROOT during a test and guarantee their
 * removal in a finally block. Without this, an assertion failure before the
 * inline `fs.rmSync` call leaves test artifacts in ~/.ignorekit.
 *
 * @param {string[]} paths - Absolute paths under USER_ROOT that the test may create
 * @returns {{ cleanup: () => void }} Call cleanup in the finally block
 */
function trackUserRootFiles(paths) {
  return {
    cleanup() {
      for (const p of paths) {
        try { fs.rmSync(p, { force: true }); } catch {}
      }
    }
  };
}

test('create preset refuses to overwrite an existing preset without --overwrite', async () => {
  const workspace = createTempWorkspace();
  try {
    // Create a preset first
    const firstResult = await runCli([
      'create', 'preset', 'existing-preset', '--component', 'language/node',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });
    assert.equal(firstResult.exitCode, 0);

    // Attempt to create the same preset without --overwrite — must fail
    const errors = [];
    const secondResult = await runCli([
      'create', 'preset', 'existing-preset', '--component', 'language/java',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(secondResult.exitCode, 1);
    assert.match(errors.join(''), /already exists.*--overwrite/i);

    // The original preset must be unchanged
    const preset = JSON.parse(fs.readFileSync(workspace.path('defs/presets/existing-preset.json'), 'utf8'));
    assert.deepEqual(preset.components, ['language/node'],
      'original preset must not be overwritten');
  } finally {
    workspace.cleanup();
  }
});

test('create preset --overwrite replaces an existing preset', async () => {
  const workspace = createTempWorkspace();
  try {
    // Create a preset first
    const firstResult = await runCli([
      'create', 'preset', 'replaceable-preset', '--component', 'language/node',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });
    assert.equal(firstResult.exitCode, 0);

    // Overwrite with --overwrite
    const secondResult = await runCli([
      'create', 'preset', 'replaceable-preset', '--component', 'language/java',
      '--overwrite', '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(secondResult.exitCode, 0);
    // The preset must be replaced with the new content
    const preset = JSON.parse(fs.readFileSync(workspace.path('defs/presets/replaceable-preset.json'), 'utf8'));
    assert.deepEqual(preset.components, ['language/java'],
      'preset should be overwritten with new components');
  } finally {
    workspace.cleanup();
  }
});

test('create component keeps category separate from the component name', async () => {
  const workspace = createTempWorkspace();
  try {
    const output = [];
    const result = await runCli([
      'create', 'component', 'runtime', '--category', 'local',
      '--rule', 'runtime/', '--rule', '*.local',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const filePath = workspace.path('defs/components/local/runtime.gitignore');
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'runtime/\n*.local\n');
    assert.match(output.join(''), new RegExp(filePath.replace(/\\/g, '\\\\')));
  } finally {
    workspace.cleanup();
  }
});

test('create component can select specific rules via --rule', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'cache/\n*.log\nprivate/\n');

    const result = await runCli([
      'create', 'component', 'runtime', '--category', 'local',
      '--from', workspace.path('project/.gitignore'),
      '--rule', 'cache/', '--rule', 'private/',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const content = fs.readFileSync(workspace.path('defs/components/local/runtime.gitignore'), 'utf8');
    assert.equal(content, 'cache/\nprivate/\n');
  } finally {
    workspace.cleanup();
  }
});

test('create component rejects whitespace-only literal rules', async () => {
  const workspace = createTempWorkspace();
  try {
    const errors = [];
    const result = await runCli([
      'create', 'component', 'local/no-empty-rules',
      '--output-root', workspace.path('defs'),
      '--rule', '   '
    ], {
      stdout: { write() {} },
      stderr: { write: text => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /non-empty strings/);
    assert.equal(fs.existsSync(workspace.path('defs/components/local/no-empty-rules.gitignore')), false);
  } finally {
    workspace.cleanup();
  }
});

test('create component rejects multi-line literal rules', async () => {
  const workspace = createTempWorkspace();
  try {
    const errors = [];
    const result = await runCli([
      'create', 'component', 'local/no-multiline-rules',
      '--output-root', workspace.path('defs'),
      '--rule', 'cache/\nlogs/'
    ], {
      stdout: { write() {} },
      stderr: { write: text => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /without line breaks/);
    assert.equal(fs.existsSync(workspace.path('defs/components/local/no-multiline-rules.gitignore')), false);
  } finally {
    workspace.cleanup();
  }
});

test('create component writes to --workspace-root when --output-root is omitted', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'create', 'component', 'local/team-runtime',
      '--workspace-root', workspace.path('team-defs'),
      '--rule', 'team-runtime/'
    ], {
      envVars: {
        IGNOREKIT_DIST_ROOT: workspace.path('dist'),
        IGNOREKIT_USER_ROOT: workspace.path('personal-defs')
      },
      stdout: { write() {} },
      stderr: { write() {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('team-defs/components/local/team-runtime.gitignore')), true);
  } finally {
    workspace.cleanup();
  }
});

test('create component --dry-run previews the target without writing a definition', async () => {
  const workspace = createTempWorkspace();
  try {
    const output = [];
    const result = await runCli([
      'create', 'component', 'local/dry-run',
      '--output-root', workspace.path('defs'),
      '--rule', 'dry-run/', '--dry-run'
    ], {
      stdout: { write: text => output.push(String(text)) },
      stderr: { write() {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('defs/components/local/dry-run.gitignore')), false);
    assert.match(output.join(''), /Dry run/);
  } finally {
    workspace.cleanup();
  }
});

test('create preset is the primary way to create presets', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'create', 'preset', 'team-vite', '--base', 'vite', '--component', 'language/node',
      '--component', 'local/runtime',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const preset = JSON.parse(fs.readFileSync(workspace.path('defs/presets/team-vite.json'), 'utf8'));
    assert.equal(preset.base, 'vite');
    assert.deepEqual(preset.components, ['language/node', 'local/runtime']);
  } finally {
    workspace.cleanup();
  }
});

test('create preset writes to --workspace-root when --output-root is omitted', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'create', 'preset', 'team-stack',
      '--workspace-root', workspace.path('team-defs'),
      '--component', 'language/node'
    ], {
      envVars: {
        IGNOREKIT_DIST_ROOT: workspace.path('dist'),
        IGNOREKIT_USER_ROOT: workspace.path('personal-defs')
      },
      stdout: { write() {} },
      stderr: { write() {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('team-defs/presets/team-stack.json')), true);
  } finally {
    workspace.cleanup();
  }
});

test('guided create preserves --workspace-root as the definition target', async () => {
  const workspace = createTempWorkspace();
  try {
    const workspaceRoot = workspace.path('team-defs');
    const componentAnswers = ['local', 'guided-runtime', '', 'runtime/', ''];
    const componentDraft = await promptComponentCreation(
      { workspaceRoot },
      {
        cwd: workspace.root,
        stdout: { write() {} },
        stderr: { write() {} },
        ask: async () => componentAnswers.shift()
      }
    );
    assert.equal(componentDraft.outputRoot, workspaceRoot);

    workspace.writeJson('dist/presets/generic.json', { name: 'generic', components: [] });
    const presetAnswers = ['guided-team', '0', ''];
    const presetDraft = await promptPresetCreation(
      { workspaceRoot },
      {
        cwd: workspace.root,
        stdout: { write() {} },
        stderr: { write() {} },
        ask: async () => presetAnswers.shift(),
        distRoot: workspace.path('dist')
      }
    );
    assert.equal(presetDraft.outputRoot, workspaceRoot);
  } finally {
    workspace.cleanup();
  }
});

test('create preset --dry-run previews the target without writing a definition', async () => {
  const workspace = createTempWorkspace();
  try {
    const output = [];
    const result = await runCli([
      'create', 'preset', 'dry-run-preset',
      '--output-root', workspace.path('defs'),
      '--component', 'language/node', '--dry-run'
    ], {
      stdout: { write: text => output.push(String(text)) },
      stderr: { write() {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('defs/presets/dry-run-preset.json')), false);
    assert.match(output.join(''), /Dry run/);
  } finally {
    workspace.cleanup();
  }
});

test('create component without arguments defaults to ./gitignore source and user scope output', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('.gitignore', 'cache/\n*.log\nprivate/\n');
    // Isolated user root to avoid polluting real ~/.ignorekit
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });
    // Prompts: category, name, source (Enter to accept default), toggle rules done, confirm
    const answers = [
      'local',                       // category
      'test-comp-no-args',           // name
      '',                            // source — accept default (./gitignore)
      '',                            // toggle rules — done
      'y'                            // confirm
    ];
    const output = [];

    const result = await runCli(['create', 'component', '--output-root', fakeUserRoot], {
      envVars: { IGNOREKIT_USER_ROOT: fakeUserRoot },
      ask: () => answers.shift(),
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'test-comp-no-args.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
    assert.equal(fs.readFileSync(userFile, 'utf8'), 'cache/\n*.log\nprivate/\n');
    assert.match(output.join(''), new RegExp(userFile.replace(/\\/g, '\\\\')));
  } finally {
    workspace.cleanup();
  }
});

test('create preset without arguments selects a base and chosen components, writes to user scope', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', components: [] });
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/local/runtime.gitignore', 'runtime/\n');
    // Create isolated user root so the test doesn't see leftover presets from real USER_ROOT
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'presets'), { recursive: true });
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });
    // Prompts: name, base, components, confirm
    const answers = [
      'team-vite-no-args',           // name
      '1',                           // base
      '1,2',                         // components
      'y'                            // confirm
    ];

    const result = await runCli([
      'create', 'preset',
      '--output-root', fakeUserRoot
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist'), IGNOREKIT_USER_ROOT: fakeUserRoot },
      ask: () => answers.shift(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const userFile = path.join(fakeUserRoot, 'presets', 'team-vite-no-args.json');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
    const preset = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    assert.equal(preset.base, 'vite');
    assert.deepEqual(preset.components, ['language/node', 'local/runtime']);
  } finally {
    workspace.cleanup();
  }
});

test('interactive component creation consumes piped terminal input across every prompt', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'cache/\n*.log\nprivate/\n');
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });
    const cliPath = path.join(__dirname, '..', 'bin', 'ignorekit.js');
    const input = [
      'local', 'runtime', workspace.path('project/.gitignore'),
      '', // toggle rules done
      'y' // confirm
    ].join('\n') + '\n';

    const result = childProcess.spawnSync(process.execPath, [
      cliPath, 'create', 'component', '--output-root', fakeUserRoot
    ], {
      cwd: workspace.root,
      input,
      encoding: 'utf8',
      env: { ...process.env, IGNOREKIT_USER_ROOT: fakeUserRoot }
    });

    assert.equal(result.status, 0, result.stderr);
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'runtime.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
    assert.equal(fs.readFileSync(userFile, 'utf8'), 'cache/\n*.log\nprivate/\n');
  } finally {
    workspace.cleanup();
  }
});

test('interactive preset creation consumes piped terminal input across every prompt', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', components: [] });
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/local/runtime.gitignore', 'runtime/\n');
    // Isolated user root
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'presets'), { recursive: true });
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });
    const cliPath = path.join(__dirname, '..', 'bin', 'ignorekit.js');
    const input = [
      'team-vite-piped', '1', '1,2',
      'y' // confirm
    ].join('\n') + '\n';

    const result = childProcess.spawnSync(process.execPath, [
      cliPath, 'create', 'preset',
      '--output-root', fakeUserRoot
    ], {
      cwd: workspace.root,
      input,
      encoding: 'utf8',
      env: { ...process.env, IGNOREKIT_DIST_ROOT: workspace.path('dist'), IGNOREKIT_USER_ROOT: fakeUserRoot }
    });

    assert.equal(result.status, 0, result.stderr);
    const userFile = path.join(fakeUserRoot, 'presets', 'team-vite-piped.json');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
    const preset = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    assert.equal(preset.base, 'vite');
    assert.deepEqual(preset.components, ['language/node', 'local/runtime']);
  } finally {
    workspace.cleanup();
  }
});

// --- #1: IGNOREKIT_USER_ROOT is a discovery layer, not an output destination ---

test('create component with IGNOREKIT_USER_ROOT env uses it for discovery, output defaults to USER_ROOT', async () => {
  const workspace = createTempWorkspace();
  const { USER_ROOT } = require('../src/core/path');
  const expectedPath = path.join(USER_ROOT, 'components', 'local', 'user-root-output-test.gitignore');
  const tracker = trackUserRootFiles([expectedPath]);
  try {
    workspace.writeText('.gitignore', 'unique-custom-rule-xyz/\n');
    const discoveryRoot = path.join(workspace.root, 'discovery-user');
    fs.mkdirSync(path.join(discoveryRoot, 'components'), { recursive: true });
    // Interactive path (no name arg) — output should still go to real USER_ROOT,
    // not to the discovery root set via IGNOREKIT_USER_ROOT.
    const answers = [
      'local',                         // category
      'user-root-output-test',         // name
      '',                              // source — accept default (./gitignore)
      '',                              // toggle rules — done
      'y'                              // confirm
    ];

    const result = await runCli([
      'create', 'component'
    ], {
      envVars: { IGNOREKIT_USER_ROOT: discoveryRoot },
      ask: () => answers.shift(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    // IGNOREKIT_USER_ROOT must NOT be treated as the output destination.
    const wrongPath = path.join(discoveryRoot, 'components', 'local', 'user-root-output-test.gitignore');
    assert.equal(fs.existsSync(wrongPath), false,
      'IGNOREKIT_USER_ROOT must not be used as the output directory');

    // Output defaults to the real USER_ROOT.
    assert.ok(fs.existsSync(expectedPath), `Expected file at ${expectedPath}`);
  } finally {
    tracker.cleanup();
    workspace.cleanup();
  }
});

// --- Smart extraction tests (now default behavior with --from) ---

test('create component --from extracts only unmatched lines (smart by default)', async () => {
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
      'create', 'component', 'custom', '--category', 'local',
      '--from', workspace.path('project/.gitignore'),
      '--output-root', workspace.path('defs')
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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
    assert.match(outputText, /Matched/);
  } finally {
    workspace.cleanup();
  }
});

test('create component --rule skips smart analysis (literal rules)', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'logs/\n.env\n');
    // --rule with no --from → literal rules, no analysis
    const result = await runCli([
      'create', 'component', 'runtime', '--category', 'local',
      '--rule', 'logs/', '--rule', '.env',
      '--output-root', workspace.path('defs')
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

test('create component --from with all lines covered returns nothing to extract', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n*.log\n');
    workspace.writeText('project/.gitignore', 'logs/\n*.log\n');

    const output = [];
    const result = await runCli([
      'create', 'component', 'custom', '--category', 'local',
      '--from', workspace.path('project/.gitignore'),
      '--output-root', workspace.path('defs')
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    // Should exit with code 1 (nothing to extract)
    assert.equal(result.exitCode, 1);
    const outputText = output.join('');
    assert.match(outputText, /already covered/);
    // No component file should be created
    assert.equal(fs.existsSync(workspace.path('defs/components/local/custom.gitignore')), false);
  } finally {
    workspace.cleanup();
  }
});

test('create component rejects invalid ids', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'logs/\n');
    const errors = [];
    const result = await runCli([
      'create', 'component', '../escape', '--category', 'local',
      '--from', workspace.path('project/.gitignore'),
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: (text) => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    // The name `../escape` contains a slash, which triggers the
    // "must be a single name, without '/'" guard before assertion of the id.
    assert.match(errors.join(''), /single name/);
  } finally {
    workspace.cleanup();
  }
});

test('create component accepts category/name syntax (infers --category)', async () => {
  // When the positional argument contains a slash (e.g. "local/runtime"),
  // the category is inferred from the prefix and the name is the suffix.
  // This matches the category/name format shown by the `list` command.
  const workspace = createTempWorkspace();
  try {
    const output = [];
    const result = await runCli([
      'create', 'component', 'local/runtime',
      '--rule', 'runtime/', '--rule', '*.local',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const filePath = workspace.path('defs/components/local/runtime.gitignore');
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'runtime/\n*.local\n');
  } finally {
    workspace.cleanup();
  }
});

test('create component requires --category when name has no slash', async () => {
  // When the name is a plain identifier without a slash, --category is
  // still required. The error message must guide the user to either use
  // the category/name syntax or pass --category explicitly.
  const workspace = createTempWorkspace();
  try {
    const errors = [];
    const result = await runCli([
      'create', 'component', 'runtime',
      '--rule', 'runtime/',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: text => errors.push(String(text)) },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.match(errors.join(''), /--category is required/);
  } finally {
    workspace.cleanup();
  }
});

test('create component category/name syntax allows explicit --category override', async () => {
  // When both the category/name syntax AND --category are provided,
  // the explicit --category takes precedence (the user was explicit).
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'create', 'component', 'local/runtime',
      '--category', 'framework',
      '--rule', 'runtime/',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    // The explicit --category framework should win over the "local" prefix
    const filePath = workspace.path('defs/components/framework/runtime.gitignore');
    assert.equal(fs.existsSync(filePath), true);
  } finally {
    workspace.cleanup();
  }
});

test('create component --from defaults to user definitions directory', async () => {
  const workspace = createTempWorkspace();
  const { USER_ROOT } = require('../src/core/path');
  const expectedPath = path.join(USER_ROOT, 'components', 'local', 'test-default.gitignore');
  const tracker = trackUserRootFiles([expectedPath]);
  try {
    workspace.writeText('project/.gitignore', 'custom-pattern/\n');
    workspace.writeText('dist/components/dummy.gitignore', '# dummy\n');

    const output = [];
    const result = await runCli([
      'create', 'component', 'test-default', '--category', 'local',
      '--from', workspace.path('project/.gitignore')
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    // The output path should be under USER_ROOT (~/.ignorekit)
    const outputText = output.join('');
    assert.match(outputText, /user definitions layer/);
  } finally {
    tracker.cleanup();
    workspace.cleanup();
  }
});

test('create component --from with --output-root writes to specified directory', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'custom-pattern/\n');
    workspace.writeText('dist/components/dummy.gitignore', '# dummy\n');

    const output = [];
    const result = await runCli([
      'create', 'component', 'test-override', '--category', 'local',
      '--from', workspace.path('project/.gitignore'),
      '--output-root', workspace.path('custom-output')
    ], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist') },
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

// --- Confirm + preview + interactive toggle tests ---

test('create component shows preview before writing', async () => {
  const workspace = createTempWorkspace();
  try {
    const output = [];
    await runCli([
      'create', 'component', 'preview-test', '--category', 'local',
      '--rule', 'one', '--rule', 'two',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    const out = output.join('');
    assert.match(out, /Component: local\/preview-test/);
    assert.match(out, /Rules \(2\)/);
    assert.match(out, /1\. one/);
    assert.match(out, /2\. two/);
    assert.match(out, /Output:/);
  } finally {
    workspace.cleanup();
  }
});

test('create preset shows preview before writing', async () => {
  const workspace = createTempWorkspace();
  try {
    const output = [];
    await runCli([
      'create', 'preset', 'preview-preset',
      '--base', 'node', '--component', 'language/node',
      '--output-root', workspace.path('defs')
    ], {
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    const out = output.join('');
    assert.match(out, /Preset: preview-preset/);
    assert.match(out, /Base: node/);
    assert.match(out, /Components \(1\)/);
    assert.match(out, /Output:/);
  } finally {
    workspace.cleanup();
  }
});

test('create component confirm=n cancels write and exits 1', async () => {
  const workspace = createTempWorkspace();
  try {
    const output = [];
    const result = await runCli([
      'create', 'component', 'cancel-test', '--category', 'local',
      '--rule', 'should-not-write',
      '--output-root', workspace.path('defs')
    ], {
      ask: () => 'n',  // answer confirm with "n"
      stdout: { write: (text) => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 1);
    assert.equal(fs.existsSync(workspace.path('defs/components/local/cancel-test.gitignore')), false);
    assert.match(output.join(''), /Cancelled/);
  } finally {
    workspace.cleanup();
  }
});

test('create component confirm=y writes the file', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'create', 'component', 'confirm-test', '--category', 'local',
      '--rule', 'written',
      '--output-root', workspace.path('defs')
    ], {
      ask: () => 'y',
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(workspace.path('defs/components/local/confirm-test.gitignore')));
  } finally {
    workspace.cleanup();
  }
});

test('create component writes when confirm callback returns true', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'create', 'component', 'yes-skip', '--category', 'local',
      '--rule', 'rule',
      '--output-root', workspace.path('defs')
    ], {
      ask: async () => '',        // default = yes for any ask prompt
      confirm: async () => true,  // confirm the write
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(workspace.path('defs/components/local/yes-skip.gitignore')));
  } finally {
    workspace.cleanup();
  }
});

test('interactive component toggle lets user deselect individual rules', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'cache/\n*.log\nprivate/\n');
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });
    // No known components, so all rules are pre-selected.
    // User toggles off rule 2 (*.log), then confirms.
    const answers = [
      'local',                            // category
      'toggletest-user',                  // name
      workspace.path('project/.gitignore'), // source
      '2',                                // toggle: turn off *.log
      'done',                             // done
      'y'                                 // confirm
    ];
    const output = [];

    const result = await runCli(['create', 'component', '--output-root', fakeUserRoot], {
      envVars: { IGNOREKIT_USER_ROOT: fakeUserRoot },
      ask: () => answers.shift(),
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'toggletest-user.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
    const content = fs.readFileSync(userFile, 'utf8');
    // *.log should be excluded after toggle
    assert.doesNotMatch(content, /\*\.log/);
    assert.match(content, /cache\//);
    assert.match(content, /private\//);
    // The toggle UI was rendered
    assert.match(output.join(''), /\[x\]/);
    assert.match(output.join(''), /\[ \]/);
  } finally {
    workspace.cleanup();
  }
});

test('interactive component toggle pre-deselects covered rules', async () => {
  const workspace = createTempWorkspace();
  try {
    // Known component covers rule 1 (.idea/) — should be pre-deselected.
    workspace.writeText('dist/components/editor/jetbrains.gitignore', '.idea/\n');
    workspace.writeText('project/.gitignore', '.idea/\ncache/\n');
    const fakeUserRoot = path.join(workspace.root, 'fake-user');
    fs.mkdirSync(path.join(fakeUserRoot, 'components'), { recursive: true });

    const answers = [
      'local',                            // category
      'preselect-user',                   // name
      workspace.path('project/.gitignore'), // source
      '',                                 // toggle — done (keep defaults)
      'y'                                 // confirm
    ];
    const output = [];

    const result = await runCli(['create', 'component', '--output-root', fakeUserRoot], {
      envVars: { IGNOREKIT_DIST_ROOT: workspace.path('dist'), IGNOREKIT_USER_ROOT: fakeUserRoot },
      ask: () => answers.shift(),
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const userFile = path.join(fakeUserRoot, 'components', 'local', 'preselect-user.gitignore');
    assert.ok(fs.existsSync(userFile), `Expected file at ${userFile}`);
    const content = fs.readFileSync(userFile, 'utf8');
    // .idea/ should be excluded (covered by jetbrains)
    assert.doesNotMatch(content, /\.idea\//);
    assert.match(content, /cache\//);
  } finally {
    workspace.cleanup();
  }
});

// --- parseNumberRanges validation ---

test('parseNumberRanges rejects double-dash input like "1--3"', () => {
  const { parseNumberRanges } = require('../src/interactive/create');
  // "1--3" splits into ["1", ""] which silently becomes just item 1.
  // The function must reject this as invalid input.
  assert.equal(parseNumberRanges('1--3', 5), null);
});

test('parseNumberRanges rejects empty range like "-"', () => {
  const { parseNumberRanges } = require('../src/interactive/create');
  assert.equal(parseNumberRanges('-', 5), null);
});

test('parseNumberRanges rejects range with empty end like "1-"', () => {
  const { parseNumberRanges } = require('../src/interactive/create');
  assert.equal(parseNumberRanges('1-', 5), null);
});

test('parseNumberRanges accepts valid range "1-3"', () => {
  const { parseNumberRanges } = require('../src/interactive/create');
  assert.deepEqual(parseNumberRanges('1-3', 5), [0, 1, 2]);
});
