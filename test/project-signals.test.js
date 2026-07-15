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

test('warns on stderr when package.json exists but is unreadable', () => {
  const workspace = createTempWorkspace();
  try {
    // Write an invalid JSON file — readJsonOrNull returns null for
    // SyntaxError, and the file exists, so the warning path is triggered.
    workspace.writeText('project/package.json', '{invalid json!!!');
    const stderrChunks = [];
    const signals = detectProjectSignals(workspace.path('project'), {
      stderr: { write: (chunk) => { stderrChunks.push(String(chunk)); return true; } }
    });
    // No Node.js signal because the JSON could not be parsed
    assert.ok(!signals.some(s => s.preset === 'node'),
      'should not detect node signal when package.json is invalid');
    // A warning must have been written to stderr
    const stderr = stderrChunks.join('');
    assert.match(stderr, /Warning.*package\.json.*could not be read/);
  } finally {
    workspace.cleanup();
  }
});
