'use strict';

const { DIST_ROOT, USER_ROOT } = require('./path');
const { createDefinitionResolver } = require('../definitions/resolver');

/**
 * Ensure the CLI knows the user-layer default. Two effects:
 *
 * 1. Sets `options.userRoot` when undefined — first checking the
 *    IGNOREKIT_USER_ROOT environment variable (used by tests to redirect
 *    to temp directories), then falling back to USER_ROOT (~/.ignorekit).
 *    Library consumers and tests that build resolvers directly stay
 *    unaffected because they call createDefinitionResolver themselves.
 * 2. Marks `options._userRootExplicit` so downstream code (component / preset
 *    writers) can tell whether the user set a custom root or whether the
 *    default was applied silently. The default carries the same intent, but
 *    surfacing a "you used --user-root but no --output-root" warning when the
 *    user never set a custom root is misleading.
 *
 * @param {object} options - Parsed CLI options (mutated in place)
 * @returns {object} The same options object
 */
function applyUserRootDefault(options) {
  if (options.userRoot === undefined || options.userRoot === null) {
    options.userRoot = process.env.IGNOREKIT_USER_ROOT || USER_ROOT;
    options._userRootExplicit = false;
  } else {
    options._userRootExplicit = true;
  }
  return options;
}

/**
 * Build a definition resolver from CLI options and environment.
 *
 * Centralizes the layer wiring that every command repeated: dist root falls back
 * to the shipped definitions (or IGNOREKIT_DIST_ROOT env var for tests), user
 * root defaults to ~/.ignorekit (or IGNOREKIT_USER_ROOT env var), and workspace
 * root is opt-in via --workspace-root.
 *
 * @param {object} params
 * @param {object} params.options - Parsed CLI options (distRoot, userRoot, workspaceRoot)
 * @param {object} [params.env] - Environment ({ cwd })
 * @param {string} [params.projectDirHint] - Directory used as project hint (for signal detection)
 * @returns {object} A definition resolver
 */
function buildResolver({ options = {}, env = {}, projectDirHint } = {}) {
  return createDefinitionResolver({
    distRoot: options.distRoot || process.env.IGNOREKIT_DIST_ROOT || DIST_ROOT,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    env
  });
}

module.exports = { buildResolver, applyUserRootDefault };
