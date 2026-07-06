'use strict';

const assert = require('assert');
const test = require('node:test');
const { loadProjectsManifest, findManifestProject } = require('../src/legacy/projects-manifest');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('loadProjectsManifest reads projects from a manifest file', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('repo/projects.json', {
      version: 1,
      projects: [
        { root: 'TestRoot', name: 'demo', preset: 'java-gradle', custom: [] }
      ]
    });

    const projects = loadProjectsManifest(workspace.path('repo'));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'demo');
  } finally {
    workspace.cleanup();
  }
});

test('findManifestProject finds a project by name and root', () => {
  const projects = [
    { root: 'A', name: 'demo', preset: 'java-gradle' },
    { root: 'B', name: 'demo', preset: 'frontend-vite' }
  ];

  const result = findManifestProject(projects, 'demo', 'A');
  assert.equal(result.preset, 'java-gradle');
});

test('findManifestProject throws when no project matches', () => {
  assert.throws(() => findManifestProject([], 'missing'), /Project not found/);
});

test('findManifestProject throws when name is ambiguous', () => {
  const projects = [
    { root: 'A', name: 'demo', preset: 'java-gradle' },
    { root: 'B', name: 'demo', preset: 'frontend-vite' }
  ];

  assert.throws(() => findManifestProject(projects, 'demo'), /ambiguous/);
});
