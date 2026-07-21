'use strict';

const fs = require('fs');
const path = require('path');
const { assertDefinitionId, resolveInside, USER_ROOT, DIST_ROOT } = require('../core/path');
const { extractStreams } = require('../core/env');

/**
 * Remove an empty directory, ignoring errors when it is not empty.
 * After deleting a component or preset, the parent category directory
 * (e.g. ~/.ignorekit/components/language/) may be left empty. This
 * best-effort cleanup removes it when possible but silently skips
 * directories that still contain other files.
 *
 * @param {string} dirPath
 */
function tryRemoveEmptyDir(dirPath) {
  try {
    fs.rmdirSync(dirPath);
  } catch (err) {
    // Any error (ENOTEMPTY, EACCES, EPERM, ENOENT, etc.) is acceptable —
    // this is best-effort cleanup. On Windows, non-empty directories may
    // throw EPERM instead of ENOTEMPTY. Don't block the remove on cleanup.
  }
}

/**
 * Check whether a definition exists in the dist (shipped) layer.
 * Shipped definitions cannot be removed — only user/workspace layer ones can.
 *
 * @param {string} type - 'component' or 'preset'
 * @param {string} id - Definition ID (e.g. 'language/java')
 * @returns {boolean}
 */
function isShippedDefinition(type, id) {
  const subDir = type === 'component' ? 'components' : 'presets';
  const ext = type === 'component' ? '.gitignore' : '.json';
  const filePath = path.join(DIST_ROOT, subDir, `${id}${ext}`);
  return fs.existsSync(filePath);
}

/**
 * Run the component removal workflow.
 *
 * @param {object} options
 * @param {string} options.id - Component ID (e.g. 'language/kotlin-canceled')
 * @param {string} [options.outputRoot] - Definition root (default: ~/.ignorekit)
 * @param {boolean} [options.yes] - Skip confirmation prompt
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {object} [env.stderr] - Writable stream for errors
 * @param {string} [env.cwd] - Current working directory
 * @param {Function} [env.confirm] - Async function returning boolean
 * @param {Function} [env.ask] - Async function returning string
 * @returns {{ id: string, removed: boolean, path: string|null }}
 */
async function runComponentRemove(options, env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  assertDefinitionId(options.id);

  // Guard: shipped definitions cannot be removed
  if (isShippedDefinition('component', options.id)) {
    throw new Error(`Shipped component cannot be removed: ${options.id}. Only user-defined components can be deleted.`);
  }

  const outputRoot = options.outputRoot
    ? path.resolve(cwd, options.outputRoot)
    : USER_ROOT;
  const filePath = resolveInside(outputRoot, path.join('components', `${options.id}.gitignore`));

  if (!fs.existsSync(filePath)) {
    throw new Error(`Component not found: ${filePath}. Only user-layer definitions can be removed.`);
  }

  // Preview
  stdout.write(`Component: ${options.id}\n`);
  stdout.write(`Path: ${filePath}\n`);

  // Confirm
  if (env.confirm) {
    const proceed = await env.confirm();
    if (!proceed) {
      stdout.write('Cancelled — no file removed.\n');
      return { id: options.id, removed: false, path: null };
    }
  }

  fs.unlinkSync(filePath);
  stdout.write(`Removed component ${options.id}\n`);

  // Best-effort cleanup of empty parent directories
  tryRemoveEmptyDir(path.dirname(filePath));
  // Also try the category directory's parent (components/) is not removed
  // because it always contains other categories, but the category dir
  // (e.g. components/language/) might now be empty.
  tryRemoveEmptyDir(path.dirname(path.dirname(filePath)));

  return { id: options.id, removed: true, path: filePath };
}

/**
 * Run the preset removal workflow.
 *
 * @param {object} options
 * @param {string} options.id - Preset ID (e.g. 'my-custom-preset')
 * @param {string} [options.outputRoot] - Definition root (default: ~/.ignorekit)
 * @param {boolean} [options.yes] - Skip confirmation prompt
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {object} [env.stderr] - Writable stream for errors
 * @param {string} [env.cwd] - Current working directory
 * @param {Function} [env.confirm] - Async function returning boolean
 * @param {Function} [env.ask] - Async function returning string
 * @returns {{ id: string, removed: boolean, path: string|null }}
 */
async function runPresetRemove(options, env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  assertDefinitionId(options.id);

  // Guard: shipped definitions cannot be removed
  if (isShippedDefinition('preset', options.id)) {
    throw new Error(`Shipped preset cannot be removed: ${options.id}. Only user-defined presets can be deleted.`);
  }

  const outputRoot = options.outputRoot
    ? path.resolve(cwd, options.outputRoot)
    : USER_ROOT;
  const filePath = resolveInside(outputRoot, path.join('presets', `${options.id}.json`));

  if (!fs.existsSync(filePath)) {
    throw new Error(`Preset not found: ${filePath}. Only user-layer definitions can be removed.`);
  }

  // Preview
  stdout.write(`Preset: ${options.id}\n`);
  stdout.write(`Path: ${filePath}\n`);

  // Confirm
  if (env.confirm) {
    const proceed = await env.confirm();
    if (!proceed) {
      stdout.write('Cancelled — no file removed.\n');
      return { id: options.id, removed: false, path: null };
    }
  }

  fs.unlinkSync(filePath);
  stdout.write(`Removed preset ${options.id}\n`);

  // Best-effort cleanup of empty presets directory
  tryRemoveEmptyDir(path.dirname(filePath));

  return { id: options.id, removed: true, path: filePath };
}

module.exports = { runComponentRemove, runPresetRemove };
