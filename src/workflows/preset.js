'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { assertDefinitionId, resolveInside, USER_ROOT } = require('../core/path');
const { extractStreams } = require('../core/env');

/**
 * Run the preset creation workflow.
 *
 * If env.confirm is provided (a function returning a Promise<boolean>), it is
 * invoked after the preview is shown. The file is only written if confirm returns true.
 *
 * @param {object} options
 * @param {string} options.name - Preset name
 * @param {string} [options.base] - Base preset to extend
 * @param {string[]} [options.components] - Components to include
 * @param {string} [options.outputRoot] - Output directory (default: ~/.ignorekit)
 * @param {boolean} [options.overwrite] - Replace an existing preset
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {string} [env.cwd] - Current working directory
 * @param {Function} [env.confirm] - Async function returning boolean; false skips write
 * @returns {{ outputPath: string|null, preset: object, resolvedComponents: string[] }}
 */
async function runPresetCreate(options, env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  assertDefinitionId(options.name);
  if (options.base) {
    assertDefinitionId(options.base);
  }
  const outputRoot = options.outputRoot
    ? path.resolve(cwd, options.outputRoot)
    : USER_ROOT;
  // --user-root is a discovery source only. Without --output-root, the preset
  // is written to the personal definitions layer (~/.ignorekit) regardless of
  // what --user-root points at, so callers always know where to find it. The
  // `_userRootExplicit` flag is set by applyUserRootDefault so the warning
  // only fires when the user actually typed --user-root.
  if (options._userRootExplicit && !options.outputRoot) {
    stderr.write(`Note: --user-root is a discovery source. Without --output-root, the file is written to ${USER_ROOT} (the default user definitions layer).\n`);
    stderr.write(`      Pass --output-root to write somewhere else.\n`);
  }
  const outputPath = resolveInside(outputRoot, path.join('presets', `${options.name}.json`));
  // The overwrite guard fires before the preview, matching the component
  // workflow's guard order. A user who already has a preset on disk should
  // learn "already exists" first; showing a preview only to throw on a
  // file-exists check at the end is wasted work and produces misleading
  // output. The guard is symmetric with component's --overwrite flag.
  if (fs.existsSync(outputPath) && !options.overwrite) {
    throw new Error(`Preset already exists: ${outputPath}. Use --overwrite to replace it.`);
  }
  const components = Array.isArray(options.components) ? options.components : [];
  const preset = {
    name: options.name,
    base: options.base,
    components
  };

  // Preview before writing
  stdout.write(`\nPreset: ${options.name}\n`);
  stdout.write(`Base: ${options.base || 'none'}\n`);
  stdout.write(`Components (${components.length}):\n`);
  if (components.length === 0) {
    stdout.write('  (none)\n');
  } else {
    for (let i = 0; i < components.length; i += 1) {
      stdout.write(`  ${i + 1}. ${components[i]}\n`);
    }
  }
  stdout.write(`Output: ${outputPath}\n`);

  if (env.confirm) {
    const proceed = await env.confirm('Write preset file? [Y/n]: ');
    if (!proceed) {
      stdout.write('Cancelled — no file written.\n');
      return { outputPath: null, preset, resolvedComponents: components };
    }
  }

  writeJson(outputPath, preset);
  stdout.write(`\nCreated preset ${options.name} → ${outputPath}\n`);
  if (!options.outputRoot) {
    stdout.write(`  Preset is available to all projects via the user definitions layer.\n`);
  }
  return { outputPath, preset, resolvedComponents: components };
}

module.exports = { runPresetCreate };