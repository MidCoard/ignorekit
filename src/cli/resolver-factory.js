'use strict';

const path = require('path');
const { DIST_ROOT, USER_ROOT } = require('../core/path');
const { createDefinitionResolver } = require('../definitions/resolver');

/**
 * Default the user definitions layer for CLI-originated option sets.
 *
 * The resolver constructor treats userRoot as opt-in (see resolver.js), so the
 * "personal definitions in ~/.ignorekit apply everywhere" behavior lives here at
 * the CLI boundary. Library consumers and tests that build resolvers directly
 * stay unaffected. An explicit --user-root (including one the interactive flow
 * carries forward) always wins.
 *
 * @param {object} options - Parsed CLI options (mutated in place)
 * @returns {object} The same options object
 */
function applyUserRootDefault(options) {
  if (options.userRoot === undefined || options.userRoot === null) {
    options.userRoot = USER_ROOT;
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
