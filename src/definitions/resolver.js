'use strict';

const fs = require('fs');
const path = require('path');
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
        const content = fs.readFileSync(filePath, 'utf8');
        return { filePath, content };
      } catch { continue; }
    }
    throw new Error(`Unknown ${kind.slice(0, -1)}: ${id}`);
  }

  return {
    readComponent(id) {
      const { content } = findDefinition('components', id, '.gitignore');
      return content;
    },
    readPreset(id) {
      const { content } = findDefinition('presets', id, '.json');
      return JSON.parse(content);
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

/**
 * Walk the preset base chain and return the fully resolved, deduplicated component list.
 * Base components come first, then own components. Duplicates are removed (first occurrence wins).
 * @param {object} resolver - A definition resolver with readPreset()
 * @param {string} presetId - Preset to resolve
 * @param {Set<string>} [visited] - Track visited presets for circular detection
 * @returns {string[]} Resolved component IDs
 */
function resolvePresetComponents(resolver, presetId, visited = new Set()) {
  if (visited.has(presetId)) {
    throw new Error(`Circular preset inheritance: ${[...visited, presetId].join(' → ')}`);
  }
  visited.add(presetId);

  const preset = resolver.readPreset(presetId);
  const ownComponents = Array.isArray(preset.components) ? preset.components : [];

  if (!preset.base) {
    return [...ownComponents];
  }

  const baseComponents = resolvePresetComponents(resolver, preset.base, visited);
  // Base components first, then own — deduplicate (first occurrence wins)
  const seen = new Set();
  const result = [];
  for (const id of [...baseComponents, ...ownComponents]) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * Walk the preset base chain and return the inheritance chain as an array
 * from root to leaf (e.g. ['generic', 'node', 'vite']).
 * @param {object} resolver - A definition resolver with readPreset()
 * @param {string} presetId - Preset to resolve
 * @param {Set<string>} [visited] - Track visited presets for circular detection
 * @returns {string[]} Inheritance chain from root to leaf
 */
function resolvePresetChain(resolver, presetId, visited = new Set()) {
  if (visited.has(presetId)) {
    throw new Error(`Circular preset inheritance: ${[...visited, presetId].join(' → ')}`);
  }
  visited.add(presetId);

  const preset = resolver.readPreset(presetId);
  if (!preset.base) {
    return [presetId];
  }
  const chain = resolvePresetChain(resolver, preset.base, visited);
  return [...chain, presetId];
}

module.exports = { createDefinitionResolver, resolvePresetComponents, resolvePresetChain };
