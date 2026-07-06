'use strict';

const fs = require('fs');
const path = require('path');
const { assertDefinitionId, resolveInside } = require('../core/path');
const { normalizeText } = require('../core/text');

function runExtractComponent(options, env) {
  assertDefinitionId(options.id);
  const sourcePath = path.resolve(env.cwd || process.cwd(), options.from);
  const outputRoot = path.resolve(env.cwd || process.cwd(), options.outputRoot || '.ignorekit');
  const outputPath = resolveInside(outputRoot, path.join('components', `${options.id}.gitignore`));
  const source = fs.readFileSync(sourcePath, 'utf8');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, normalizeText(source), 'utf8');
  return { outputPath };
}

module.exports = { runExtractComponent };
