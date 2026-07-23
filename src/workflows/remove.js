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
 * Resolve the writable definition target. Explicit output roots take
 * precedence over workspace and user roots.
 *
 * @param {object} options
 * @param {string} cwd
 * @returns {string}
 */
function resolveOutputRoot(options, cwd) {
  const root = options.outputRoot || options.workspaceRoot || options.userRoot || USER_ROOT;
  return path.resolve(cwd, root);
}

function assertWritableDefinitionRoot(outputRoot, options) {
  const distRoot = path.resolve(options.distRoot || process.env.IGNOREKIT_DIST_ROOT || DIST_ROOT);
  if (path.resolve(outputRoot) === distRoot) {
    throw new Error('Shipped definitions cannot be removed. Choose a user or workspace definition root.');
  }
}

/**
 * Run the component removal workflow.
 *
 * @param {object} options
 * @param {string} options.id - Component ID (e.g. 'language/kotlin-canceled')
 * @param {string} [options.outputRoot] - Definition root (default: ~/.ignorekit)
 * @param {boolean} [options.confirm] - Confirm removal without prompt
 * @param {boolean} [options.dryRun] - Preview without deleting
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
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

  const outputRoot = resolveOutputRoot(options, cwd);
  assertWritableDefinitionRoot(outputRoot, options);
  const filePath = resolveInside(outputRoot, path.join('components', `${options.id}.gitignore`));

  if (!fs.existsSync(filePath)) {
    throw new Error(`Component not found: ${filePath}. Only user-layer definitions can be removed.`);
  }

  // Preview
  stdout.write(`Component: ${options.id}\n`);
  stdout.write(`Path: ${filePath}\n`);

  if (options.dryRun) {
    stdout.write('Dry run -- no component file removed.\n');
    return { id: options.id, removed: false, path: filePath, dryRun: true };
  }

  // Confirm — guard against non-interactive environments
  if (!env.confirm && !options.confirm) {
    throw new Error('Confirmation required. Use --confirm to skip the prompt in non-interactive mode.');
  }
  if (env.confirm && !options.confirm) {
    const proceed = await env.confirm('Remove this component? [y/N]: ');
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
 * @param {boolean} [options.confirm] - Confirm removal without prompt
 * @param {boolean} [options.dryRun] - Preview without deleting
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
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

  const outputRoot = resolveOutputRoot(options, cwd);
  assertWritableDefinitionRoot(outputRoot, options);
  const filePath = resolveInside(outputRoot, path.join('presets', `${options.id}.json`));

  if (!fs.existsSync(filePath)) {
    throw new Error(`Preset not found: ${filePath}. Only user-layer definitions can be removed.`);
  }

  // Preview
  stdout.write(`Preset: ${options.id}\n`);
  stdout.write(`Path: ${filePath}\n`);

  if (options.dryRun) {
    stdout.write('Dry run -- no preset file removed.\n');
    return { id: options.id, removed: false, path: filePath, dryRun: true };
  }

  // Confirm — guard against non-interactive environments
  if (!env.confirm && !options.confirm) {
    throw new Error('Confirmation required. Use --confirm to skip the prompt in non-interactive mode.');
  }
  if (env.confirm && !options.confirm) {
    const proceed = await env.confirm('Remove this preset? [y/N]: ');
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
