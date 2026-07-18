'use strict';

const path = require('path');
const { readJson } = require('../core/json');
const { normalizeProjectConfig } = require('../config/project-config');
const { resolvePresetComponents, resolvePresetChain } = require('../definitions/resolver');
const { buildResolver } = require('../core/resolver-factory');
const { parseSignificantLines } = require('../core/text');
const { debugError } = require('../core/debug');

/**
 * Format a brief summary of component content for the table.
 * @param {string[]} lines - Significant lines
 * @returns {string}
 */
function summarizeLines(lines) {
  // Leading whitespace is insignificant in gitignore syntax — use trimStart()
  // to detect negation patterns after whitespace, matching detectNegationPatterns.
  const negations = lines.filter(l => l.trimStart().startsWith('!'));
  const patterns = lines.filter(l => !l.trimStart().startsWith('!'));
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
 * Print a single component's detail line (and optional verbose content) to stdout.
 * Returns true if the component was successfully read and displayed, false if skipped.
 *
 * @param {string} componentId - Component ID to display
 * @param {object} resolver - Definition resolver
 * @param {object} options - { verbose }
 * @param {object} streams - { stdout, stderr }
 * @param {Set<string>} resolvedComponents - Set to add successfully resolved IDs to
 * @returns {boolean}
 */
function printComponentDetail(componentId, resolver, options, streams, resolvedComponents) {
  let content;
  try {
    content = resolver.readComponent(componentId);
  } catch (err) {
    debugError(err, 'explain.readComponent', streams);
    streams.stderr.write(`Warning: could not read component "${componentId}" — skipping. Set IGNOREKIT_DEBUG=1 for details.\n`);
    return false;
  }
  resolvedComponents.add(componentId);
  const lines = parseSignificantLines(content);
  const ruleCount = lines.length;
  const summary = summarizeLines(lines);
  const pad = 24;
  const idPadded = componentId.padEnd(pad);
  const countLabel = `${ruleCount} rule${ruleCount !== 1 ? 's' : ''}`;
  streams.stdout.write(`  ${idPadded} ${countLabel.padEnd(10)} ${summary}\n`);

  if (options.verbose) {
    for (const line of content.split('\n')) {
      streams.stdout.write(`    ${line}\n`);
    }
    streams.stdout.write('\n');
  }
  return true;
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
  const stderr = env.stderr || process.stderr;
  const configPath = path.resolve(env.cwd || process.cwd(), options.configPath);
  const rawConfig = readJson(configPath);
  const config = normalizeProjectConfig(rawConfig);

  const projectDir = path.dirname(configPath);
  const resolver = buildResolver({ options, env, projectDirHint: projectDir });

  // Resolve preset components and inheritance chain
  const presetComponents = config.preset
    ? resolvePresetComponents(resolver, config.preset)
    : [];
  const excludeSet = new Set(config.exclude || []);
  const filteredPresetComponents = presetComponents.filter(id => !excludeSet.has(id));
  const extraComponents = config.components || [];
  const allComponents = [...filteredPresetComponents, ...extraComponents];

  // Track component IDs that were successfully read — missing components are
  // skipped during display and excluded from the returned component list so
  // callers never see an ID that cannot be resolved.
  const resolvedComponents = new Set();

  // Compute inheritance chain once — reused for header display and component grouping
  let chain = null;
  if (config.preset) {
    try {
      chain = resolvePresetChain(resolver, config.preset);
    } catch (err) {
      debugError(err, 'explain.chain', env);
      // Chain resolution failed — chain remains null
    }
  }

  // Build inheritance chain display for header
  let chainDisplay = '';
  if (chain && chain.length > 1) {
    chainDisplay = ` (extends ${chain.slice(0, -1).join(' → ')})`;
  }

  // Header
  stdout.write(`Project: ${config.name}\n`);
  if (config.preset) {
    stdout.write(`Preset:  ${config.preset}${chainDisplay} (${filteredPresetComponents.length} component${filteredPresetComponents.length !== 1 ? 's' : ''})\n`);
  } else {
    stdout.write('Preset:  none\n');
  }
  stdout.write('\n');

  // Group preset components by their level in the inheritance chain
  if (filteredPresetComponents.length > 0 && config.preset) {
    // Build a map: presetId → its own components (not inherited)
    const ownComponentsMap = new Map();
    try {
      for (const presetId of (chain || [config.preset])) {
        const presetDef = resolver.readPreset(presetId);
        const own = Array.isArray(presetDef.components) ? presetDef.components : [];
        ownComponentsMap.set(presetId, own);
      }
    } catch (err) {
      debugError(err, 'explain.preset-components', env);
      // Fallback: show all under the preset name
      ownComponentsMap.set(config.preset, presetComponents);
    }

    // Track which components we've already shown (dedup across levels)
    const shown = new Set();

    for (const [presetId, ownIds] of ownComponentsMap) {
      // Only show components not already shown by a base preset, and not excluded
      const newIds = ownIds.filter(id => !shown.has(id) && !excludeSet.has(id));
      if (newIds.length === 0) continue;
      for (const id of newIds) shown.add(id);

      const label = presetId === config.preset ? `From "${presetId}":` : `From ${presetId}:`;
      stdout.write(`${label}\n`);
      for (const componentId of newIds) {
        printComponentDetail(componentId, resolver, options, { stdout, stderr }, resolvedComponents);
      }
      stdout.write('\n');
    }
  }

  // Excluded components
  if (excludeSet.size > 0) {
    stdout.write('Excluded from preset:\n');
    for (const componentId of config.exclude) {
      stdout.write(`  ${componentId}\n`);
    }
    stdout.write('\n');
  }

  // Extra components
  if (extraComponents.length > 0) {
    stdout.write('Extra components:\n');
    for (const componentId of extraComponents) {
      printComponentDetail(componentId, resolver, options, { stdout, stderr }, resolvedComponents);
    }
    stdout.write('\n');
  } else if (filteredPresetComponents.length > 0) {
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
    components: allComponents.filter(id => resolvedComponents.has(id)),
    customCount
  };
}

module.exports = { runExplainWorkflow, parseSignificantLines, summarizeLines };
