'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('create component keeps category separate from the component name', async () => {
  const workspace = createTempWorkspace();
  try {
    const output = [];
    const result = await runCli([
      'create', 'component', 'runtime', '--category', 'local',
      '--rule', 'runtime/', '--rule', '*.local', '--output-root', workspace.path('defs')
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

test('create component can select specific rules from an existing gitignore', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'cache/\n*.log\nprivate/\n');

    const result = await runCli([
      'create', 'component', 'runtime', '--category', 'local',
      '--from', workspace.path('project/.gitignore'), '--rule', 'cache/', '--rule', 'private/',
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

test('create preset is the primary alias for preset create', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'create', 'preset', 'team-vite', '--base', 'vite', '--component', 'language/node',
      '--component', 'local/runtime', '--output-root', workspace.path('defs')
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

test('create component without arguments lets the user select source rules and review the output path', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'cache/\n*.log\nprivate/\n');
    const answers = [
      'local',
      'runtime',
      workspace.path('project/.gitignore'),
      '1,3',
      'custom',
      workspace.path('defs'),
      'write'
    ];
    const output = [];

    const result = await runCli(['create', 'component'], {
      ask: () => answers.shift(),
      stdout: { write: text => output.push(String(text)) },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.readFileSync(workspace.path('defs/components/local/runtime.gitignore'), 'utf8'), 'cache/\nprivate/\n');
    assert.match(output.join(''), /Output: .*components[\\/]local[\\/]runtime\.gitignore/);
  } finally {
    workspace.cleanup();
  }
});

test('create preset without arguments selects a base and chosen components', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', components: [] });
    workspace.writeText('dist/components/language/node.gitignore', 'node_modules/\n');
    workspace.writeText('dist/components/local/runtime.gitignore', 'runtime/\n');
    const answers = [
      'team-vite',
      '1',
      '1,2',
      'custom',
      workspace.path('defs'),
      'write'
    ];

    const result = await runCli(['create', 'preset', '--dist-root', workspace.path('dist')], {
      ask: () => answers.shift(),
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

test('legacy preset command without arguments starts the same guided creation flow', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', components: [] });
    const answers = ['team-vite', '1', '', 'custom', workspace.path('defs'), 'write'];

    const result = await runCli(['preset', '--dist-root', workspace.path('dist')], {
      ask: () => answers.shift(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(fs.readFileSync(workspace.path('defs/presets/team-vite.json'), 'utf8')).base, 'vite');
  } finally {
    workspace.cleanup();
  }
});

test('extract without arguments starts guided component creation', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'cache/\n*.log\n');
    const answers = ['local', 'runtime', workspace.path('project/.gitignore'), '1', 'custom', workspace.path('defs'), 'write'];

    const result = await runCli(['extract'], {
      ask: () => answers.shift(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.readFileSync(workspace.path('defs/components/local/runtime.gitignore'), 'utf8'), 'cache/\n');
  } finally {
    workspace.cleanup();
  }
});

test('interactive component creation consumes piped terminal input across every prompt', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'cache/\n*.log\nprivate/\n');
    const cliPath = path.join(__dirname, '..', 'bin', 'ignorekit.js');
    const input = [
      'local', 'runtime', workspace.path('project/.gitignore'), '1,3',
      'custom', workspace.path('defs'), 'write'
    ].join('\n') + '\n';

    const result = childProcess.spawnSync(process.execPath, [cliPath, 'create', 'component'], {
      cwd: workspace.root,
      input,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(workspace.path('defs/components/local/runtime.gitignore'), 'utf8'), 'cache/\nprivate/\n');
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
    const cliPath = path.join(__dirname, '..', 'bin', 'ignorekit.js');
    const input = [
      'team-vite', '1', '1,2', 'custom', workspace.path('defs'), 'write'
    ].join('\n') + '\n';

    const result = childProcess.spawnSync(process.execPath, [
      cliPath, 'create', 'preset', '--dist-root', workspace.path('dist')
    ], {
      cwd: workspace.root,
      input,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    const preset = JSON.parse(fs.readFileSync(workspace.path('defs/presets/team-vite.json'), 'utf8'));
    assert.equal(preset.base, 'vite');
    assert.deepEqual(preset.components, ['language/node', 'local/runtime']);
  } finally {
    workspace.cleanup();
  }
});
