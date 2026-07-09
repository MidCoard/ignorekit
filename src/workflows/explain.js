'use strict';

const path = require('path');
const { readJson } = require('../core/json');
const { normalizeProjectConfig } = require('../config/project-config');
const { createDefinitionResolver } = require('../definitions/resolver');
const { DIST_ROOT } = require('../core/path');

/**
 * Parse significant (non-comment, non-blank) lines from gitignore content.
 * @param {string} content
 * @returns {string[]}
 */
function parseSignificantLines(content) {
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

/**
 * Format a brief summary of component content for the table.
 * @param {string[]} lines - Significant lines
 * @returns {string}
 */
function summarizeLines(lines) {
  const negations = lines.filter(l => l.startsWith('!'));
  const patterns = lines.filter(l => !l.startsWith('!'));
  if (negations.length === 0) {
    if (patterns.length <= 3) return patterns.join(', ');
    return `${patterns.slice(0, 2).join(', ')}, ...`;
  }
  if (patterns.length <= 2) {
    const base = patterns.join(', ');
    return negations.length > 0 ? `${base} + ${negations.length} negation${negations.length > 1 ? 's' : ''}` : base;
  }
  return `${patterns[0]}, ... + ${negations.length} negation${negations.length > 1 ? 's' : ''}`;
}

/**
 * Run the explain workflow.
 * @param {object} options
 * @param {string} options.configPath - Path to ignorekit.json
 * @param {boolean} [options.verbose] - Show full component content
 * @param {string} [options.distRoot] - Override dist root
 * @param {string} [options.userRoot] - User-level override directory
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {string} [env.cwd] - Current working directory
 * @returns {{ project: string, preset: string|null, components: string[], customCount: number }}
 */
function runExplainWorkflow(options, env) {
  const stdout = env.stdout || process.stdout;
  const configPath = path.resolve(env.cwd || process.cwd(), options.configPath);
  const rawConfig = readJson(configPath);
  const config = normalizeProjectConfig(rawConfig);

  const projectRoot = path.dirname(configPath);
  const resolver = createDefinitionResolver({
    distRoot: options.distRoot || DIST_ROOT,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot
  });

  // Resolve preset components
  const preset = config.preset ? resolver.readPreset(config.preset) : null;
  const presetComponents = preset ? (Array.isArray(preset.components) ? preset.components : []) : [];
  const extraComponents = config.components || [];
  const allComponents = [...presetComponents, ...extraComponents];

  // Header
  stdout.write(`Project: ${config.name}\n`);
  if (config.preset) {
    stdout.write(`Preset:  ${config.preset} (${presetComponents.length} component${presetComponents.length !== 1 ? 's' : ''})\n`);
  } else {
    stdout.write(`Preset:  none\n`);
  }
  stdout.write('\n');

  // Preset components
  if (presetComponents.length > 0) {
    stdout.write(`From preset "${config.preset}":\n`);
    for (const componentId of presetComponents) {
      const content = resolver.readComponent(componentId);
      const lines = parseSignificantLines(content);
      const ruleCount = lines.length;
      const summary = summarizeLines(lines);
      const pad = 24;
      const idPadded = componentId.padEnd(pad);
      const countLabel = `${ruleCount} rule${ruleCount !== 1 ? 's' : ''}`;
      stdout.write(`  ${idPadded} ${countLabel.padEnd(10)} ${summary}\n`);

      if (options.verbose) {
        for (const line of content.split('\n')) {
          stdout.write(`    ${line}\n`);
        }
        stdout.write('\n');
      }
    }
    stdout.write('\n');
  }

  // Extra components
  if (extraComponents.length > 0) {
    stdout.write('Extra components:\n');
    for (const componentId of extraComponents) {
      const content = resolver.readComponent(componentId);
      const lines = parseSignificantLines(content);
      const ruleCount = lines.length;
      const summary = summarizeLines(lines);
      const pad = 24;
      const idPadded = componentId.padEnd(pad);
      const countLabel = `${ruleCount} rule${ruleCount !== 1 ? 's' : ''}`;
      stdout.write(`  ${idPadded} ${countLabel.padEnd(10)} ${summary}\n`);

      if (options.verbose) {
        for (const line of content.split('\n')) {
          stdout.write(`    ${line}\n`);
        }
        stdout.write('\n');
      }
    }
    stdout.write('\n');
  } else if (presetComponents.length > 0) {
    stdout.write('Extra components: (none)\n\n');
  }

  // Custom rules
  const customCount = config.custom.length;
  stdout.write(`Custom rules: ${customCount}\n`);
  if (customCount > 0) {
    for (const pattern of config.custom) {
      stdout.write(`  ${pattern}\n`);
    }
  }
  stdout.write('\n');

  return {
    project: config.name,
    preset: config.preset || null,
    components: allComponents,
    customCount
  };
}

module.exports = { runExplainWorkflow, parseSignificantLines, summarizeLines };
