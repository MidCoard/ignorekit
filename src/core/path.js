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
  // The regex allows dots within segments (e.g. "framework/next.js"), which
  // means "category/.hidden" passes the `..` check but creates a hidden
  // directory. This is accepted as a defense-in-depth trade-off: the `..`
  // check blocks path traversal, and hidden-directory creation requires write
  // access to the definitions root (already a trusted operation). Tightening
  // the regex to reject dots would break legitimate component names that
  // include file extensions.
  //
  // Additional guards reject IDs that would normalize to the same path as
  // another ID: double slashes (e.g. "a//b" normalizes to "a/b"), dot-segment
  // prefixes (e.g. "./a" normalizes to "a"), and trailing slashes (e.g. "a/"
  // normalizes to "a"). Without these, two different IDs could resolve to the
  // same file, causing ambiguous lookups.
  if (id.includes('//') || id.startsWith('./') || id.endsWith('/')) {
    throw new Error(`Invalid definition id: ${id}`);
  }
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
