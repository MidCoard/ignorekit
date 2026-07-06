'use strict';

const assert = require('assert');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { createDefinitionResolver } = require('../src/definitions/resolver');

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
