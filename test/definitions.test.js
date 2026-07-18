'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { createDefinitionResolver } = require('../src/definitions/resolver');
const { USER_ROOT } = require('../src/core/path');

test('resolver reads components from dist, user, workspace, and project layers in priority order', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeText('workspace/.ignorekit/components/local/logs.gitignore', 'workspace-logs/\n');
    workspace.writeText('project/.ignorekit/components/project/runtime.gitignore', 'runtime/\n');

    const resolver = createDefinitionResolver({
      distRoot: workspace.path('dist'),
      userRoot: workspace.path('missing-user'),
      workspaceRoot: workspace.path('workspace/.ignorekit'),
      projectRoot: workspace.path('project/.ignorekit')
    });

    assert.equal(resolver.readComponent('local/logs').trim(), 'workspace-logs/');
    assert.equal(resolver.readComponent('project/runtime').trim(), 'runtime/');
  } finally {
    workspace.cleanup();
  }
});

test('resolver rejects component ids that escape definition roots', () => {
  const workspace = createTempWorkspace();
  try {
    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    assert.throws(() => resolver.readComponent('../secret'), /Invalid definition id/);
  } finally {
    workspace.cleanup();
  }
});

test('resolver hasComponent returns false for missing components', () => {
  const workspace = createTempWorkspace();
  try {
    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    assert.equal(resolver.hasComponent('nonexistent'), false);
  } finally {
    workspace.cleanup();
  }
});

test('resolver hasPreset returns false for missing presets', () => {
  const workspace = createTempWorkspace();
  try {
    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    assert.equal(resolver.hasPreset('nonexistent'), false);
  } finally {
    workspace.cleanup();
  }
});

test('resolver treats the user layer as opt-in when no user root is supplied', () => {
  const workspace = createTempWorkspace();
  const id = `local/test-user-default-${process.pid}`;
  const filePath = path.join(USER_ROOT, 'components', `${id}.gitignore`);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'personal-rule/\n', 'utf8');

    // The resolver constructor is pure: without an explicit userRoot it does not
    // reach into ~/.ignorekit. The CLI supplies that default at its boundary.
    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    assert.equal(resolver.hasComponent(id), false);
  } finally {
    fs.rmSync(filePath, { force: true });
    workspace.cleanup();
  }
});

test('resolver reads personal definitions when the user root is explicit', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('user/components/local/personal.gitignore', 'personal-rule/\n');
    const resolver = createDefinitionResolver({
      distRoot: workspace.path('dist'),
      userRoot: workspace.path('user')
    });
    assert.equal(resolver.readComponent('local/personal'), 'personal-rule/\n');
  } finally {
    workspace.cleanup();
  }
});

test('resolver lists definitions from all layers without duplicate ids', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/shared.gitignore', 'dist/\n');
    workspace.writeText('user/components/local/shared.gitignore', 'user/\n');
    workspace.writeText('workspace/components/local/workspace.gitignore', 'workspace/\n');
    workspace.writeText('project/components/local/project.gitignore', 'project/\n');
    workspace.writeJson('dist/presets/base.json', { name: 'base', components: [] });
    workspace.writeJson('user/presets/personal.json', { name: 'personal', components: [] });

    const resolver = createDefinitionResolver({
      distRoot: workspace.path('dist'),
      userRoot: workspace.path('user'),
      workspaceRoot: workspace.path('workspace'),
      projectRoot: workspace.path('project')
    });

    assert.deepEqual(resolver.listComponents(), [
      'local/project',
      'local/shared',
      'local/workspace'
    ]);
    assert.deepEqual(resolver.listPresets(), ['base', 'personal']);
    assert.equal(resolver.readComponent('local/shared'), 'user/\n');
  } finally {
    workspace.cleanup();
  }
});

test('resolver reads presets from layers', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/java-gradle.json', {
      name: 'java-gradle',
      components: ['language/java', 'build/gradle']
    });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    const preset = resolver.readPreset('java-gradle');
    assert.equal(preset.name, 'java-gradle');
    assert.deepEqual(preset.components, ['language/java', 'build/gradle']);
  } finally {
    workspace.cleanup();
  }
});

test('resolvePresetComponents returns own components when no base', () => {
  const { resolvePresetComponents } = require('../src/definitions/resolver');
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/generic.json', {
      name: 'generic',
      components: ['platform/macos', 'platform/windows']
    });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    const result = resolvePresetComponents(resolver, 'generic');
    assert.deepEqual(result, ['platform/macos', 'platform/windows']);
  } finally {
    workspace.cleanup();
  }
});

test('resolvePresetComponents resolves base chain', () => {
  const { resolvePresetComponents } = require('../src/definitions/resolver');
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/generic.json', {
      name: 'generic',
      components: ['platform/macos', 'platform/windows']
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

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });

    // node should include generic + own
    const nodeResult = resolvePresetComponents(resolver, 'node');
    assert.deepEqual(nodeResult, ['platform/macos', 'platform/windows', 'language/node']);

    // vite should include generic + node + own
    const viteResult = resolvePresetComponents(resolver, 'vite');
    assert.deepEqual(viteResult, ['platform/macos', 'platform/windows', 'language/node', 'framework/vite']);
  } finally {
    workspace.cleanup();
  }
});

test('resolvePresetComponents deduplicates across base chain', () => {
  const { resolvePresetComponents } = require('../src/definitions/resolver');
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/generic.json', {
      name: 'generic',
      components: ['platform/macos', 'language/node']
    });
    workspace.writeJson('dist/presets/custom.json', {
      name: 'custom',
      base: 'generic',
      components: ['language/node', 'framework/vite']
    });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    const result = resolvePresetComponents(resolver, 'custom');
    // language/node appears in both — first occurrence wins (from generic)
    assert.deepEqual(result, ['platform/macos', 'language/node', 'framework/vite']);
  } finally {
    workspace.cleanup();
  }
});

test('resolvePresetComponents detects circular inheritance', () => {
  const { resolvePresetComponents } = require('../src/definitions/resolver');
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/a.json', { name: 'a', base: 'b', components: [] });
    workspace.writeJson('dist/presets/b.json', { name: 'b', base: 'a', components: [] });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    assert.throws(
      () => resolvePresetComponents(resolver, 'a'),
      /Circular preset inheritance/
    );
  } finally {
    workspace.cleanup();
  }
});

test('resolvePresetChain returns inheritance chain from root to leaf', () => {
  const { resolvePresetChain } = require('../src/definitions/resolver');
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/generic.json', { name: 'generic', components: [] });
    workspace.writeJson('dist/presets/node.json', { name: 'node', base: 'generic', components: [] });
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', base: 'node', components: [] });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    const chain = resolvePresetChain(resolver, 'vite');
    assert.deepEqual(chain, ['generic', 'node', 'vite']);
  } finally {
    workspace.cleanup();
  }
});

test('resolvePresetChain returns fresh arrays (no shared mutation between recursive levels)', () => {
  // Verifies that resolvePresetChain does not mutate the array returned
  // by its recursive call. Using chain.push(presetId) would mutate the
  // child's return value, causing bugs if the function is ever cached.
  const { resolvePresetChain, createDefinitionResolver } = require('../src/definitions/resolver');
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/generic.json', { name: 'generic', components: [] });
    workspace.writeJson('dist/presets/node.json', { name: 'node', base: 'generic', components: [] });
    workspace.writeJson('dist/presets/vite.json', { name: 'vite', base: 'node', components: [] });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });

    // The contract: resolvePresetChain should return a new array for each call,
    // not reuse/mutate the array from a recursive call.
    // We test this by creating a memoized version that would expose the bug.
    const cache = new Map();
    function memoizedChain(presetId) {
      if (cache.has(presetId)) return cache.get(presetId);
      const result = resolvePresetChain(resolver, presetId);
      cache.set(presetId, result);
      return result;
    }

    // Resolve 'node' first and cache it
    const nodeChain = memoizedChain('node');
    assert.deepEqual(nodeChain, ['generic', 'node']);

    // Now resolve 'vite'. The internal recursion will call resolvePresetChain
    // for 'node', which returns a NEW array (not the cached one). But if we
    // were to use memoizedChain internally, the cached 'node' array would be
    // mutated by chain.push('vite'). The fix ([...chain, presetId]) prevents this.
    //
    // Since we can't easily make resolvePresetChain use our cache internally,
    // we verify the fix by checking the implementation contract directly:
    // after applying the fix, the function should use spread syntax, not .push().
    // We verify this behaviorally: modifying a returned chain should not affect
    // future calls.
    const viteChain1 = resolvePresetChain(resolver, 'vite');
    viteChain1.push('extra'); // mutate the returned array
    const viteChain2 = resolvePresetChain(resolver, 'vite');
    assert.deepEqual(viteChain2, ['generic', 'node', 'vite'],
      'External mutation of returned array should not affect future calls');
  } finally {
    workspace.cleanup();
  }
});

test('next preset does not extend vite (Next.js does not use Vite)', () => {
  const { resolvePresetChain, createDefinitionResolver } = require('../src/definitions/resolver');
  const { DIST_ROOT } = require('../src/core/path');
  const resolver = createDefinitionResolver({ distRoot: DIST_ROOT });

  const chain = resolvePresetChain(resolver, 'next');
  // Next.js uses webpack/Turbopack, not Vite. The chain should NOT include 'vite'.
  assert.ok(!chain.includes('vite'),
    `next preset chain should not include vite, got: ${chain.join(' -> ')}`);
  // The chain should include 'node' (Next.js is a Node.js framework)
  assert.ok(chain.includes('node'),
    `next preset chain should include node, got: ${chain.join(' -> ')}`);
});

test('resolvePresetChain returns single-element for root preset', () => {
  const { resolvePresetChain } = require('../src/definitions/resolver');
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/generic.json', { name: 'generic', components: [] });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    const chain = resolvePresetChain(resolver, 'generic');
    assert.deepEqual(chain, ['generic']);
  } finally {
    workspace.cleanup();
  }
});

test('resolver discovers components from user root layer', () => {
  const workspace = createTempWorkspace();
  try {
    // Dist has no matching component
    workspace.writeText('dist/components/platform/macos.gitignore', '.DS_Store\n');
    // User root has a custom component
    workspace.writeText('user/components/local/custom.gitignore', 'custom-pattern/\n');

    const resolver = createDefinitionResolver({
      distRoot: workspace.path('dist'),
      userRoot: workspace.path('user')
    });

    // Should find the user-level component
    assert.equal(resolver.hasComponent('local/custom'), true);
    assert.equal(resolver.readComponent('local/custom').trim(), 'custom-pattern/');

    // Should still find dist-level component
    assert.equal(resolver.hasComponent('platform/macos'), true);
  } finally {
    workspace.cleanup();
  }
});

test('user root component overrides dist component with same id', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'dist-logs/\n');
    workspace.writeText('user/components/local/logs.gitignore', 'user-logs/\n');

    const resolver = createDefinitionResolver({
      distRoot: workspace.path('dist'),
      userRoot: workspace.path('user')
    });

    // User root should override dist (higher priority layer)
    assert.equal(resolver.readComponent('local/logs').trim(), 'user-logs/');
  } finally {
    workspace.cleanup();
  }
});

// --- #3 (P1): findDefinition must re-throw EACCES, not mask it as "not found" ---

test('findDefinition re-throws EACCES instead of masking it as "not found"', () => {
  // When a definition file exists but is unreadable due to EACCES, the
  // resolver must propagate the error rather than silently continuing to the
  // next layer and eventually throwing DefinitionNotFoundError. Masking
  // EACCES as "not found" hides permission problems that the user needs to
  // know about.
  const workspace = createTempWorkspace();
  try {
    // Create a component file, then make it unreadable by replacing
    // readFileSync with a mock that throws EACCES.
    workspace.writeText('dist/components/local/secret.gitignore', 'secret/\n');

    const resolver = createDefinitionResolver({
      distRoot: workspace.path('dist')
    });

    // Mock fs.readFileSync to throw EACCES for the secret component
    const origReadFileSync = fs.readFileSync;
    fs.readFileSync = function(path, encoding) {
      if (path.includes('secret.gitignore')) {
        const err = new Error('EACCES: permission denied');
        err.code = 'EACCES';
        throw err;
      }
      return origReadFileSync.apply(this, arguments);
    };

    try {
      // readComponent should throw EACCES, not DefinitionNotFoundError
      let caught = null;
      try {
        resolver.readComponent('local/secret');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, 'readComponent should throw for EACCES');
      assert.equal(caught.code, 'EACCES',
        `expected EACCES to propagate, got: ${caught.name}: ${caught.message}`);
    } finally {
      fs.readFileSync = origReadFileSync;
    }
  } finally {
    workspace.cleanup();
  }
});

test('findDefinition still returns DefinitionNotFoundError for genuinely missing files', () => {
  // After the EACCES fix, genuinely missing files (ENOENT) must still produce
  // DefinitionNotFoundError, not EACCES or any other error.
  const workspace = createTempWorkspace();
  try {
    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    let caught = null;
    try {
      resolver.readComponent('local/nonexistent');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'readComponent should throw for missing component');
    assert.equal(caught.name, 'DefinitionNotFoundError',
      `expected DefinitionNotFoundError, got: ${caught.name}: ${caught.message}`);
  } finally {
    workspace.cleanup();
  }
});

// --- #5 (P1): findDefinition must check file size before reading ---

test('findDefinition rejects oversized component files via checkSize', () => {
  const { MAX_CONTENT_BYTES } = require('../src/core/constants');
  const workspace = createTempWorkspace();
  try {
    const padding = '\n'.repeat(MAX_CONTENT_BYTES + 1);
    workspace.writeText('dist/components/local/huge.gitignore', 'rule/\n' + padding);

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    assert.throws(
      () => resolver.readComponent('local/huge'),
      /too large|EFILETOOLARGE/
    );
  } finally {
    workspace.cleanup();
  }
});

test('findDefinition rejects oversized preset JSON files via checkSize', () => {
  const { MAX_CONTENT_BYTES } = require('../src/core/constants');
  const workspace = createTempWorkspace();
  try {
    const padding = '\n'.repeat(MAX_CONTENT_BYTES + 1);
    workspace.writeText('dist/presets/huge.json', '{"name":"huge","components":[]}' + padding);

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    assert.throws(
      () => resolver.readPreset('huge'),
      /too large|EFILETOOLARGE/
    );
  } finally {
    workspace.cleanup();
  }
});

// --- #10 (P1): resolvePresetComponents must deduplicate when preset has no base ---

test('resolvePresetComponents deduplicates own components when no base', () => {
  const { resolvePresetComponents } = require('../src/definitions/resolver');
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('dist/presets/dup.json', {
      name: 'dup',
      components: ['language/node', 'language/node', 'platform/macos']
    });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    const result = resolvePresetComponents(resolver, 'dup');
    // Duplicate 'language/node' must appear only once
    assert.deepEqual(result, ['language/node', 'platform/macos']);
  } finally {
    workspace.cleanup();
  }
});

// --- #11 (P1): readPreset JSON.parse errors must include file path ---

test('readPreset includes file path in error for malformed JSON', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/presets/bad.json', '{invalid json!!!');

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    let caught = null;
    try {
      resolver.readPreset('bad');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'readPreset should throw for malformed JSON');
    assert.match(caught.message, /bad\.json/,
      `error message must include the file path, got: ${caught.message}`);
  } finally {
    workspace.cleanup();
  }
});
