'use strict';

const path = require('path');
const { DIST_ROOT, USER_ROOT } = require('../core/path');
const { createDefinitionResolver } = require('../definitions/resolver');

/**
 * Ensure the CLI knows the user-layer default. Two effects:
 *
 * 1. Sets `options.userRoot = USER_ROOT` when undefined so the resolver picks
 *    up the personal definitions layer (~/.ignorekit) — this is the historical
 *    CLI behavior. Library consumers and tests that build resolvers directly
 *    stay unaffected because they call createDefinitionResolver themselves.
 * 2. Marks `options._userRootExplicit` so downstream code (component / preset
 *    writers) can tell whether the user typed `--user-root` or whether the
 *    default was applied silently. The default carries the same intent, but
 *    surfacing a "you used --user-root but no --output-root" warning when the
 *    user never typed --user-root is misleading.
 *
 * @param {object} options - Parsed CLI options (mutated in place)
 * @returns {object} The same options object
 */
function applyUserRootDefault(options) {
  if (options.userRoot === undefined || options.userRoot === null) {
    options.userRoot = USER_ROOT;
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
 * to the shipped definitions, and the project layer is the `.ignorekit` directory
 * beside the relevant working location. Callers pass projectDirHint to point the
 * project layer at a config directory or project path; it defaults to env.cwd.
 *
 * @param {object} params
 * @param {object} params.options - Parsed CLI options (distRoot, userRoot, workspaceRoot)
 * @param {object} [params.env] - Environment ({ cwd })
 * @param {string} [params.projectDirHint] - Directory whose `.ignorekit` is the project layer
 * @returns {object} A definition resolver
 */
function buildResolver({ options = {}, env = {}, projectDirHint } = {}) {
  const projectDir = projectDirHint || env.cwd || process.cwd();
  return createDefinitionResolver({
    distRoot: options.distRoot || DIST_ROOT,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: options.projectRoot || path.join(projectDir, '.ignorekit')
  });
}

module.exports = { buildResolver, applyUserRootDefault };
