'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const test = require('node:test');
const { runComponentRemove, runPresetRemove } = require('../src/workflows/remove');

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ignorekit-remove-'));
  return {
    root: dir,
    writeText(relPath, content) {
      const fullPath = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
    },
    exists(relPath) {
      return fs.existsSync(path.join(dir, relPath));
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

// --- Component removal ---

test('remove component deletes the file and returns removed=true', async () => {
  const tmp = createTempDir();
  try {
    tmp.writeText('components/language/test-comp.gitignore', '# test\n*.log\n');
    assert.ok(tmp.exists('components/language/test-comp.gitignore'));

    const res = await runComponentRemove(
      { id: 'language/test-comp', outputRoot: tmp.root },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    );
    assert.equal(res.removed, true);
    assert.equal(res.id, 'language/test-comp');
    assert.ok(!tmp.exists('components/language/test-comp.gitignore'),
      'component file should be deleted');
  } finally {
    tmp.cleanup();
  }
});

test('remove component cleans up empty category directory', async () => {
  const tmp = createTempDir();
  try {
    tmp.writeText('components/lonely/only-one.gitignore', '*.tmp\n');
    assert.ok(tmp.exists('components/lonely/only-one.gitignore'));

    await runComponentRemove(
      { id: 'lonely/only-one', outputRoot: tmp.root },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    );
    assert.ok(!tmp.exists('components/lonely'),
      'empty category directory should be removed');
  } finally {
    tmp.cleanup();
  }
});

test('remove component does not delete category directory with other files', async () => {
  const tmp = createTempDir();
  try {
    tmp.writeText('components/language/test-a.gitignore', '*.a\n');
    tmp.writeText('components/language/test-b.gitignore', '*.b\n');

    await runComponentRemove(
      { id: 'language/test-a', outputRoot: tmp.root },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    );
    assert.ok(!tmp.exists('components/language/test-a.gitignore'),
      'removed file should be gone');
    assert.ok(tmp.exists('components/language/test-b.gitignore'),
      'sibling file should remain');
    assert.ok(tmp.exists('components/language'),
      'non-empty category directory should remain');
  } finally {
    tmp.cleanup();
  }
});

test('remove component refuses shipped (dist-layer) definitions', async () => {
  // language/java is a shipped component
  await assert.rejects(
    () => runComponentRemove(
      { id: 'language/java' },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    ),
    /Shipped component cannot be removed/
  );
});

test('remove component errors when file not found', async () => {
  await assert.rejects(
    () => runComponentRemove(
      { id: 'nonexistent/thing' },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    ),
    /Component not found/
  );
});

test('remove component with confirm=false does not delete', async () => {
  const tmp = createTempDir();
  try {
    tmp.writeText('components/local/keep-me.gitignore', '*.keep\n');

    const result = await runComponentRemove(
      { id: 'local/keep-me', outputRoot: tmp.root },
      {
        stdout: { write() {} },
        stderr: { write() {} },
        cwd: process.cwd(),
        confirm: async () => false
      }
    );
    assert.equal(result.removed, false);
    assert.ok(tmp.exists('components/local/keep-me.gitignore'),
      'file should still exist after declined confirm');
  } finally {
    tmp.cleanup();
  }
});

test('remove component with --yes skips confirm and deletes', async () => {
  const tmp = createTempDir();
  try {
    tmp.writeText('components/local/skip-confirm.gitignore', '*.skip\n');

    // buildCreateEnv with skipConfirm=true omits env.confirm
    const result = await runComponentRemove(
      { id: 'local/skip-confirm', outputRoot: tmp.root, yes: true },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
      // no env.confirm — simulates --yes
    );
    assert.equal(result.removed, true);
    assert.ok(!tmp.exists('components/local/skip-confirm.gitignore'));
  } finally {
    tmp.cleanup();
  }
});

test('remove component rejects invalid IDs', async () => {
  await assert.rejects(
    () => runComponentRemove(
      { id: '../etc/passwd' },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    ),
    /Invalid definition id/
  );
});

// --- Preset removal ---

test('remove preset deletes the file and returns removed=true', async () => {
  const tmp = createTempDir();
  try {
    tmp.writeText('presets/my-custom.json', '{"name":"my-custom","components":[]}');

    const res = await runPresetRemove(
      { id: 'my-custom', outputRoot: tmp.root },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    );
    assert.equal(res.removed, true);
    assert.ok(!tmp.exists('presets/my-custom.json'));
  } finally {
    tmp.cleanup();
  }
});

test('remove preset refuses shipped (dist-layer) definitions', async () => {
  // java-gradle is a shipped preset
  await assert.rejects(
    () => runPresetRemove(
      { id: 'java-gradle' },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    ),
    /Shipped preset cannot be removed/
  );
});

test('remove preset errors when file not found', async () => {
  await assert.rejects(
    () => runPresetRemove(
      { id: 'nonexistent-preset' },
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    ),
    /Preset not found/
  );
});

test('remove preset with confirm=false does not delete', async () => {
  const tmp = createTempDir();
  try {
    tmp.writeText('presets/keep-preset.json', '{"name":"keep-preset","components":[]}');

    const result = await runPresetRemove(
      { id: 'keep-preset', outputRoot: tmp.root },
      {
        stdout: { write() {} },
        stderr: { write() {} },
        cwd: process.cwd(),
        confirm: async () => false
      }
    );
    assert.equal(result.removed, false);
    assert.ok(tmp.exists('presets/keep-preset.json'));
  } finally {
    tmp.cleanup();
  }
});

// --- CLI dispatch ---

test('remove command dispatches to component removal', async () => {
  const { runCli } = require('../src/cli');
  const tmp = createTempDir();
  try {
    tmp.writeText('components/local/cli-test.gitignore', '*.cli\n');

    const result = await runCli(
      ['remove', 'component', 'local/cli-test', '--output-root', tmp.root, '--yes'],
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    );
    assert.equal(result.exitCode, 0);
    assert.ok(!tmp.exists('components/local/cli-test.gitignore'));
  } finally {
    tmp.cleanup();
  }
});

test('remove command dispatches to preset removal', async () => {
  const { runCli } = require('../src/cli');
  const tmp = createTempDir();
  try {
    tmp.writeText('presets/cli-preset.json', '{"name":"cli-preset","components":[]}');

    const result = await runCli(
      ['remove', 'preset', 'cli-preset', '--output-root', tmp.root, '--yes'],
      { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
    );
    assert.equal(result.exitCode, 0);
    assert.ok(!tmp.exists('presets/cli-preset.json'));
  } finally {
    tmp.cleanup();
  }
});

test('remove without subcommand errors', async () => {
  const { runCli } = require('../src/cli');
  const result = await runCli(
    ['remove'],
    { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
  );
  assert.equal(result.exitCode, 1);
});

test('remove component without ID errors', async () => {
  const { runCli } = require('../src/cli');
  const result = await runCli(
    ['remove', 'component'],
    { stdout: { write() {} }, stderr: { write() {} }, cwd: process.cwd() }
  );
  assert.equal(result.exitCode, 1);
});

test('help remove shows usage', async () => {
  const { runCli } = require('../src/cli');
  let output = '';
  const result = await runCli(
    ['help', 'remove'],
    { stdout: { write(s) { output += s; } }, stderr: { write() {} }, cwd: process.cwd() }
  );
  assert.equal(result.exitCode, 0);
  assert.ok(output.includes('remove component'));
  assert.ok(output.includes('remove preset'));
});
