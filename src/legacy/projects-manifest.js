'use strict';

const path = require('path');
const { readJson } = require('../core/json');

function loadProjectsManifest(repoRoot) {
  const manifest = readJson(path.join(repoRoot, 'projects.json'));
  return Array.isArray(manifest.projects) ? manifest.projects : [];
}

function findManifestProject(projects, name, root) {
  const matches = projects.filter((project) => project.name === name && (!root || project.root === root));
  if (matches.length === 0) {
    throw new Error(root ? `Project not found: ${root}/${name}` : `Project not found: ${name}`);
  }
  if (matches.length > 1) {
    throw new Error(`Project name '${name}' is ambiguous. Use --root.`);
  }
  return matches[0];
}

module.exports = { loadProjectsManifest, findManifestProject };
