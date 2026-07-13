'use strict';

const os = require('os');
const path = require('path');

const definitionIdPattern = /^[a-z0-9][a-z0-9._/-]*$/i;

const DIST_ROOT = path.resolve(__dirname, '..', '..');

/** User-level definitions directory — shared across all projects. */
const USER_ROOT = path.join(os.homedir(), '.ignorekit');

function assertDefinitionId(id) {
  // Reject ids beginning with a dot so callers cannot define a component whose
  // name collides with hidden system directories (e.g. ".git", ".idea").
  if (!definitionIdPattern.test(id) || id.includes('..') || id.startsWith('.')) {
    throw new Error(`Invalid definition id: ${id}`);
  }
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const relation = path.relative(root, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`Path escapes root: ${relativePath}`);
  }
  return target;
}

module.exports = { assertDefinitionId, resolveInside, DIST_ROOT, USER_ROOT };
