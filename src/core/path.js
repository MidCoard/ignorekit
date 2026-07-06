'use strict';

const path = require('path');

const definitionIdPattern = /^[a-z0-9][a-z0-9._/-]*$/i;

function assertDefinitionId(id) {
  if (!definitionIdPattern.test(id) || id.includes('..')) {
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

module.exports = { assertDefinitionId, resolveInside };
