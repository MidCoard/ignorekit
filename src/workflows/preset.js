'use strict';

const path = require('path');
const { writeJson } = require('../core/json');
const { assertDefinitionId, resolveInside, USER_ROOT } = require('../core/path');

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
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {string} [env.cwd] - Current working directory
 * @param {Function} [env.confirm] - Async function returning boolean; false skips write
 * @returns {{ outputPath: string|null, preset: object, resolvedComponents: string[] }}
 */
async function runPresetCreate(options, env) {
  const stdout = env.stdout || process.stdout;
  assertDefinitionId(options.name);
  const outputRoot = options.outputRoot
    ? path.resolve(env.cwd || process.cwd(), options.outputRoot)
    : USER_ROOT;
  const outputPath = resolveInside(outputRoot, path.join('presets', `${options.name}.json`));
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
    const proceed = await env.confirm();
    if (!proceed) {
      stdout.write('Cancelled — no file written.\n');
      return { outputPath: null, preset, resolvedComponents: components };
    }
  }

  writeJson(outputPath, preset);
  stdout.write(`\nCreated preset ${outputPath}\n`);
  if (!options.outputRoot) {
    stdout.write(`  Preset is available to all projects via the user definitions layer.\n`);
  }
  return { outputPath, preset, resolvedComponents: components };
}

module.exports = { runPresetCreate };