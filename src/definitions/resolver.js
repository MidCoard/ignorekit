'use strict';

const fs = require('fs');
const path = require('path');
const { listDefinitions } = require('../core/fs');
const { assertDefinitionId, resolveInside } = require('../core/path');
const { checkSize } = require('../core/json');
const { debugError } = require('../core/debug');

/**
 * Thrown by findDefinition when no layer contains the requested component or
 * preset. Using a custom error class lets hasComponent/hasPreset distinguish
 * "not found" from unexpected errors (e.g. EACCES) without fragile
 * string-matching on error.message.
 */
class DefinitionNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DefinitionNotFoundError';
  }
}

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
  // The user layer is opt-in: callers must pass an explicit userRoot to enable
  // it. The dist CLI supplies ~/.ignorekit at the entry point (runCli) so its UX
  // is unchanged, while library consumers and tests get a pure resolver that
  // touches only the roots they name.
  const layers = [
    options.distRoot,
    options.userRoot,
    options.workspaceRoot,
    options.projectRoot
  ].filter(Boolean);
  // Capture env once at construction so debugError inside findDefinition can
  // route to the caller's stderr stream (e.g. a test's env.stderr) rather than
  // always falling back to process.stderr. The resolver is long-lived — env
  // is fixed at creation, which matches the resolver's immutable-layer design.
  const resolverEnv = options.env;

  function findDefinition(kind, id, extension) {
    assertDefinitionId(id);
    for (const root of [...layers].reverse()) {
      try {
        const filePath = resolveInside(root, path.join(kind, `${id}${extension}`));
        checkSize(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        return { filePath, content };
      } catch (err) {
        // Only ENOENT (file not found) is expected — optional layers may not
        // contain the requested definition, so the search continues to the
        // next layer. Other errors (EACCES, EISDIR, etc.) indicate a real
        // problem that the caller needs to know about; re-throwing them
        // prevents silently masking permission issues as "definition not found".
        if (err.code !== 'ENOENT') throw err;
        // DEBUG-LOG: surface the file path under IGNOREKIT_DEBUG so a
        // misconfigured root is visible without changing the lookup contract.
        debugError(err, `resolver.read.${kind}`, resolverEnv);
        continue;
      }
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
    throw new DefinitionNotFoundError(message);
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
      const { content, filePath } = findDefinition('presets', id, '.json');
      try {
        return JSON.parse(content);
      } catch (err) {
        const wrapped = new Error(`Failed to parse preset JSON ${filePath}: ${err.message}`);
        if (err.code) wrapped.code = err.code;
        wrapped.cause = err;
        throw wrapped;
      }
    },
    hasComponent(id) {
      try {
        findDefinition('components', id, '.gitignore');
        return true;
      } catch (error) {
        if (error instanceof DefinitionNotFoundError) return false;
        throw error;
      }
    },
    hasPreset(id) {
      try {
        findDefinition('presets', id, '.json');
        return true;
      } catch (error) {
        if (error instanceof DefinitionNotFoundError) return false;
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
 * Check for circular preset inheritance. Throws if the preset has already
 * been visited in the current resolution chain. Shared by
 * resolvePresetComponents and resolvePresetChain so the circular-detection
 * logic and error message are defined in one place.
 * @param {string} presetId - Preset being entered
 * @param {Set<string>} visited - Presets already seen in this chain
 */
function checkCircular(presetId, visited) {
  if (visited.has(presetId)) {
    throw new Error(`Circular preset inheritance: ${[...visited, presetId].join(' → ')}`);
  }
  visited.add(presetId);
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
  checkCircular(presetId, visited);

  const preset = resolver.readPreset(presetId);
  const ownComponents = Array.isArray(preset.components) ? preset.components : [];

  if (!preset.base) {
    visited.delete(presetId);
    return [...new Set(ownComponents)];
  }

  const baseComponents = resolvePresetComponents(resolver, preset.base, visited);
  // Backtrack: remove this preset from the visited set so sibling branches
  // in a diamond inheritance graph do not falsely detect a cycle. The
  // visited set tracks the current path from root to leaf; once we return
  // from a subtree, that subtree's nodes are no longer "on the current path".
  visited.delete(presetId);
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
  checkCircular(presetId, visited);

  const preset = resolver.readPreset(presetId);
  if (!preset.base) {
    visited.delete(presetId);
    return [presetId];
  }
  const chain = resolvePresetChain(resolver, preset.base, visited);
  // Backtrack: same reasoning as resolvePresetComponents — remove this
  // preset from the visited set so sibling branches in a diamond graph
  // are not falsely flagged as circular.
  visited.delete(presetId);
  return [...chain, presetId];
}

module.exports = { createDefinitionResolver, resolvePresetComponents, resolvePresetChain, DefinitionNotFoundError };
