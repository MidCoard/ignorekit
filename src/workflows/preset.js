'use strict';

const path = require('path');
const { writeJson } = require('../core/json');
const { assertDefinitionId, resolveInside, USER_ROOT } = require('../core/path');

function runPresetCreate(options, env) {
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
  writeJson(outputPath, preset);
  return { outputPath, preset };
}

module.exports = { runPresetCreate };
