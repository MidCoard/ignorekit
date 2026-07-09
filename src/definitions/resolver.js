'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('../core/json');
const { assertDefinitionId, resolveInside } = require('../core/path');

function createDefinitionResolver(options = {}) {
  const layers = [
    options.distRoot,
    options.userRoot,
    options.workspaceRoot,
    options.projectRoot
  ].filter(Boolean);

  function findDefinition(kind, id, extension) {
    assertDefinitionId(id);
    for (const root of [...layers].reverse()) {
      try {
        const filePath = resolveInside(root, path.join(kind, `${id}${extension}`));
        fs.readFileSync(filePath, 'utf8');
        return filePath;
      } catch { continue; }
    }
    throw new Error(`Unknown ${kind.slice(0, -1)}: ${id}`);
  }

  return {
    readComponent(id) {
      return fs.readFileSync(findDefinition('components', id, '.gitignore'), 'utf8');
    },
    readPreset(id) {
      return readJson(findDefinition('presets', id, '.json'));
    },
    hasComponent(id) {
      try {
        findDefinition('components', id, '.gitignore');
        return true;
      } catch (error) {
        if (error.message.startsWith('Unknown component')) return false;
        throw error;
      }
    },
    hasPreset(id) {
      try {
        findDefinition('presets', id, '.json');
        return true;
      } catch (error) {
        if (error.message.startsWith('Unknown preset')) return false;
        throw error;
      }
    }
  };
}

module.exports = { createDefinitionResolver };
