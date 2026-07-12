'use strict';

const fs = require('fs');
const path = require('path');
const { assertDefinitionId, resolveInside, USER_ROOT } = require('../core/path');
const { normalizeText, parseSignificantLines } = require('../core/text');

function assertSegment(value, label) {
  if (!value || typeof value !== 'string' || value.includes('/')) {
    throw new Error(`${label} must be a single name, without '/'.`);
  }
  assertDefinitionId(value);
}

function runComponentCreate(options, env) {
  assertSegment(options.category, 'category');
  assertSegment(options.name, 'component name');

  const outputRoot = options.outputRoot
    ? path.resolve(env.cwd || process.cwd(), options.outputRoot)
    : USER_ROOT;
  const id = `${options.category}/${options.name}`;
  const outputPath = resolveInside(outputRoot, path.join('components', `${id}.gitignore`));
  if (fs.existsSync(outputPath) && !options.overwrite) {
    throw new Error(`Component already exists: ${outputPath}. Use --overwrite to replace it.`);
  }

  let rules = Array.isArray(options.rules) ? options.rules : [];
  if (rules.length === 0 && options.from) {
    const sourcePath = path.resolve(env.cwd || process.cwd(), options.from);
    rules = parseSignificantLines(fs.readFileSync(sourcePath, 'utf8'));
  }
  if (rules.some(rule => typeof rule !== 'string' || rule.length === 0)) {
    throw new Error('component rules must be non-empty strings');
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, normalizeText(rules.join('\n')), 'utf8');
  return { id, outputPath, rules };
}

module.exports = { runComponentCreate };
