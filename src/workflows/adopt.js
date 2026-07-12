'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { DIST_ROOT } = require('../core/path');
const { parseSignificantLines } = require('../core/text');
const { buildProjectConfig } = require('../config/build-config');
const { createDefinitionResolver, resolvePresetComponents } = require('../definitions/resolver');
const { generateGitignore } = require('../generator');
const { listTrackedIgnoredFiles, removeCachedFiles } = require('../git');
const { analyzeGitignore } = require('./analyze');

/**
 * Run the adopt workflow.
 *
 * Enhanced: first analyzes the project's existing .gitignore against known
 * components, showing what the chosen preset covers vs what's custom.
 * Then creates the config and generates the gitignore.
 *
 * @param {object} options
 * @param {string} options.projectPath - Path to the existing project directory
 * @param {string} options.preset - Preset name
 * @param {boolean} [options.apply] - Overwrite .gitignore directly
 * @param {boolean} [options.overwriteConfig] - Overwrite existing ignorekit.json
 * @param {boolean} [options.removeCached] - Remove Git-tracked files that should be ignored
 * @param {boolean} [options.yes] - Confirm removal without prompt
 * @param {string} [options.distRoot] - Override dist root
 * @param {string} [options.userRoot] - User-level override directory
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {string} [env.cwd] - Current working directory
 * @returns {{ projectPath: string, configPath: string, cachedRemoval: object, analysis: object|null, warnings: string[] }}
 */
async function runAdoptWorkflow(options, env) {
  const stdout = env.stdout || process.stdout;
  const projectPath = path.resolve(env.cwd || process.cwd(), options.projectPath);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  if (options.removeCached && !options.apply) {
    throw new Error('--remove-cached requires --apply so Git uses the generated .gitignore');
  }

  const distRoot = options.distRoot || DIST_ROOT;
  const warnings = [];

  // Analyze existing .gitignore if present
  let analysis = null;
  const existingGitignorePath = path.join(projectPath, '.gitignore');
  if (fs.existsSync(existingGitignorePath)) {
    analysis = analyzeGitignore({
      gitignorePath: existingGitignorePath,
      distRoot,
      userRoot: options.userRoot,
      workspaceRoot: options.workspaceRoot
    });

    stdout.write('Analyzing existing .gitignore...\n\n');

    if (analysis.displayMatchedComponents.length > 0) {
      stdout.write(`Already covered by ${analysis.displayMatchedComponents.length} known component(s):\n`);
      for (const comp of analysis.displayMatchedComponents) {
        const status = comp.classification === 'full' ? '✓ full' : '✗ partial';
        stdout.write(`  ${comp.id.padEnd(24)} ${comp.matched.length}/${comp.total} rules ${status}\n`);
      }
      stdout.write('\n');
    }

    if (analysis.unmatchedLines.length > 0) {
      stdout.write(`Rules needing review (${analysis.unmatchedLines.length}):\n`);
      for (const line of analysis.unmatchedLines) {
        stdout.write(`  ${line}\n`);
      }
      stdout.write('\n');
    }

    // Compare chosen preset against analysis
    const resolver = createDefinitionResolver({
      distRoot,
      userRoot: options.userRoot,
      workspaceRoot: options.workspaceRoot,
      projectRoot: path.join(projectPath, '.ignorekit')
    });

    try {
      const presetComponents = resolvePresetComponents(resolver, options.preset);

      // Find components in the preset that are NOT matched in the current .gitignore
      const newComponents = presetComponents.filter(id => {
        const match = analysis.matchedComponents.find(c => c.id === id);
        return !match || match.classification !== 'full';
      });

      // Find matched components NOT in the chosen preset (will be lost if not in custom)
      const presetSet = new Set(presetComponents);
      const lostComponents = analysis.matchedComponents.filter(c => c.classification === 'full' && !presetSet.has(c.id));

      if (newComponents.length > 0) {
        stdout.write(`Preset "${options.preset}" will add ${newComponents.length} new component(s):\n`);
        for (const id of newComponents) {
          stdout.write(`  ${id}\n`);
        }
        stdout.write('\n');
      }

      if (lostComponents.length > 0) {
        const lostWarning = `Current .gitignore has rules from ${lostComponents.length} component(s) not in preset "${options.preset}":`;
        warnings.push(lostWarning);
        stdout.write(`⚠ ${lostWarning}\n`);
        for (const comp of lostComponents) {
          stdout.write(`  ${comp.id} (${comp.total} rules)\n`);
          warnings.push(`  ${comp.id}: ${comp.total} rules will not be in generated .gitignore unless added as extra components`);
        }
        stdout.write('  Add them as extra components in ignorekit.json if needed.\n\n');
      }

      // Check if the chosen preset is the best match
      if (analysis.bestPreset && analysis.bestPreset.id !== options.preset) {
        const suggestion = `Analysis suggests preset "${analysis.bestPreset.id}" (score: ${analysis.bestPreset.score}) may be a better match than "${options.preset}".`;
        warnings.push(suggestion);
        stdout.write(`💡 ${suggestion}\n\n`);
      }
    } catch {
      // Preset not found — will error below when config is built
    }
  }

  // Build and write config
  const config = buildProjectConfig(path.basename(projectPath), options);

  // Keep only rules that the chosen preset and extra components do not cover.
  if (analysis) {
    const resolver = createDefinitionResolver({
      distRoot,
      userRoot: options.userRoot,
      workspaceRoot: options.workspaceRoot,
      projectRoot: path.join(projectPath, '.ignorekit')
    });
    const selectedComponentIds = new Set(options.components || []);
    try {
      for (const id of resolvePresetComponents(resolver, options.preset)) {
        selectedComponentIds.add(id);
      }
    } catch {
      // The generator reports invalid presets with its usual error message.
    }
    const coveredRules = new Set();
    for (const id of selectedComponentIds) {
      const result = analysis.componentResults.get(id);
      if (result) {
        for (const line of result.matched) coveredRules.add(line);
      }
    }

    // Deduplicate (some .gitignore files have the same rule twice).
    const seen = new Set();
    const customRules = [];
    const existingRules = parseSignificantLines(fs.readFileSync(existingGitignorePath, 'utf8'));
    for (const line of existingRules) {
      if (!coveredRules.has(line) && !seen.has(line)) {
        seen.add(line);
        customRules.push(line);
      }
    }
    config.custom = customRules;
  }

  const configPath = path.join(projectPath, 'ignorekit.json');
  if (fs.existsSync(configPath) && !options.overwriteConfig) {
    throw new Error(`Config already exists: ${configPath}. Use --overwrite-config to replace.`);
  }
  // Generate .gitignore
  const resolver = createDefinitionResolver({
    distRoot,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: path.join(projectPath, '.ignorekit')
  });
  const gitignore = await generateGitignore({ config, resolver });
  const outputName = options.apply ? '.gitignore' : '.gitignore.preview';
  const outputLabel = options.apply ? '.gitignore' : '.gitignore.preview';
  writeJson(configPath, config);
  fs.writeFileSync(path.join(projectPath, outputName), gitignore, 'utf8');

  stdout.write(`Generated ${outputLabel}\n`);

  // Handle cached file removal
  let cachedRemoval = { action: 'skipped', files: [] };
  if (options.removeCached) {
    const files = listTrackedIgnoredFiles(projectPath);
    cachedRemoval = removeCachedFiles(projectPath, files, { dryRun: !options.yes });
    if (cachedRemoval.action === 'dry-run' && cachedRemoval.files.length > 0) {
      stdout.write('Files that would be removed from Git index:\n');
      for (const file of cachedRemoval.files) {
        stdout.write(`  ${file}\n`);
      }
    }
  }

  return { projectPath, configPath, cachedRemoval, analysis, warnings };
}

module.exports = { runAdoptWorkflow };
