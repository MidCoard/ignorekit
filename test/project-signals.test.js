'use strict';

const assert = require('assert');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { detectProjectSignals } = require('../src/detection/project-signals');

test('detects Vite from package.json scripts and dependencies', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('project/package.json', {
      scripts: { dev: 'vite', build: 'vite build' },
      devDependencies: { vite: '^5.0.0' }
    });

    assert.deepEqual(detectProjectSignals(workspace.path('project')), [{
      preset: 'vite',
      evidence: 'Vite detected in package.json',
      strength: 1000
    }]);
  } finally {
    workspace.cleanup();
  }
});

test('detects Gradle and Maven without reading source files', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('gradle/build.gradle', 'plugins { id \'java\' }\n');
    workspace.writeText('maven/pom.xml', '<project/>\n');

    assert.deepEqual(detectProjectSignals(workspace.path('gradle')), [{
      preset: 'java-gradle',
      evidence: 'Gradle build detected',
      strength: 900
    }]);
    assert.deepEqual(detectProjectSignals(workspace.path('maven')), [{
      preset: 'java-maven',
      evidence: 'Maven build detected',
      strength: 900
    }]);
  } finally {
    workspace.cleanup();
  }
});

test('prefers a framework-specific signal over a shared Vite dependency', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('project/package.json', {
      dependencies: { nuxt: '^3.0.0' },
      devDependencies: { vite: '^5.0.0' }
    });

    assert.deepEqual(detectProjectSignals(workspace.path('project')), [{
      preset: 'nuxt',
      evidence: 'Nuxt detected in package.json',
      strength: 1000
    }]);
  } finally {
    workspace.cleanup();
  }
});

test('returns no signal for a project without standard manifests', () => {
  const workspace = createTempWorkspace();
  try {
    assert.deepEqual(detectProjectSignals(workspace.root), []);
  } finally {
    workspace.cleanup();
  }
});
