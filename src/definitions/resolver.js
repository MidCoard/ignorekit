'use strict';

const fs = require('fs');
const path = require('path');
const { listDefinitions } = require('../core/fs');
const { assertDefinitionId, resolveInside, USER_ROOT } = require('../core/path');

/**
 * Compute a simple edit-distance score between two strings.
 * Returns the number of single-character edits (insert/delete/substitute)
 * needed to transform a into b. Used for "did you mean?" suggestions.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const temp = dp[i];
      dp[i] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = temp;
    }
  }
  return dp[m];
}

/**
 * Find the closest match for an unknown ID among known candidates.
 * Returns the best candidate if within a reasonable edit-distance threshold,
 * or null if nothing is close enough.
 * @param {string} id - The unknown ID the user provided
 * @param {string[]} candidates - Known valid IDs
 * @returns {string|null}
 */
function suggestSimilar(id, candidates) {
  if (candidates.length === 0) return null;
  const threshold = Math.max(2, Math.floor(id.length / 2));
  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = editDistance(id, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return bestDist <= threshold ? best : null;
}

function createDefinitionResolver(options = {}) {
  const layers = [
    options.distRoot,
    options.userRoot === undefined ? USER_ROOT : options.userRoot,
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
    const singular = kind.slice(0, -1);
    const knownIds = listDefinitionIds(kind, extension);
    const suggestion = suggestSimilar(id, knownIds);
    let message = `Unknown ${singular}: ${id}`;
    if (suggestion) {
      message += `. Did you mean '${suggestion}'?`;
    } else if (knownIds.length > 0) {
      message += `. Available: ${knownIds.slice(0, 5).join(', ')}${knownIds.length > 5 ? `, ... (${knownIds.length} total)` : ''}`;
    }
    throw new Error(message);
  }

  function listDefinitionIds(kind, extension) {
    const ids = new Set();
    for (const root of layers) {
      for (const id of listDefinitions(path.join(root, kind), extension)) {
        ids.add(id);
      }
    }
    return [...ids].sort();
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
    },
    listComponents() {
      return listDefinitionIds('components', '.gitignore');
    },
    listPresets() {
      return listDefinitionIds('presets', '.json');
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
