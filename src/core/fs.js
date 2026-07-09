'use strict';

const fs = require('fs');
const path = require('path');

function walkFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
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
