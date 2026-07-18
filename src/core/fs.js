'use strict';

const fs = require('fs');
const path = require('path');
const { debugError } = require('./debug');

/**
 * Maximum recursion depth for walkFiles. Prevents stack overflow from
 * pathological directory structures (e.g. circular symlinks that evade
 * the isSymbolicLink check, or excessively deep nesting). Real definition
 * directories are at most 3-4 levels deep (e.g. components/framework/vite).
 */
const MAX_WALK_DEPTH = 20;

function walkFiles(directory, depth = 0) {
  if (depth > MAX_WALK_DEPTH) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    // Symlinks are skipped to prevent infinite recursion when a symlink
    // points to an ancestor directory. Definition directories are owned
    // by ignorekit and should not contain symlinks; if one appears (e.g.
    // a user-created symlink in ~/.ignorekit), skipping it is the safe
    // default. Use entry.isSymbolicLink() rather than lstat for
    // efficiency — readdir with withFileTypes already has the dtype.
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, depth + 1));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function listDefinitions(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  try {
    return walkFiles(directory)
      .filter((file) => file.endsWith(extension))
      .map((file) => path.relative(directory, file).replace(/\\/g, '/').replace(new RegExp(`\\${extension}$`), ''))
      .sort();
  } catch (err) {
    // An EACCES (or similar) on a layer directory must not crash the entire
    // resolution. Log under IGNOREKIT_DEBUG and return an empty list so the
    // resolver continues with the remaining layers. Without this guard, a
    // single unreadable directory (e.g. ~/.ignorekit with restrictive perms)
    // prevents listing ANY definitions from ANY layer.
    debugError(err, 'fs.listDefinitions');
    return [];
  }
}

module.exports = { walkFiles, listDefinitions };
