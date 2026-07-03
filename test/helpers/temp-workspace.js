'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createTempWorkspace(prefix = 'ignorekit-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  return {
    root,
    path: (...parts) => path.join(root, ...parts),
    writeJson(relativePath, value) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
      return target;
    },
    writeText(relativePath, value) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, value, 'utf8');
      return target;
    },
    readText(relativePath) {
      return fs.readFileSync(path.join(root, relativePath), 'utf8');
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

module.exports = { createTempWorkspace };
