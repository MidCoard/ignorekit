'use strict';

const fs = require('fs');
const path = require('path');

function walkFiles(directory) {
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
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function listDefinitions(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return walkFiles(directory)
    .filter((file) => file.endsWith(extension))
    .map((file) => path.relative(directory, file).replace(/\\/g, '/').replace(new RegExp(`\\${extension}$`), ''))
    .sort();
}

module.exports = { walkFiles, listDefinitions };
