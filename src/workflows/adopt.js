'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { DIST_ROOT } = require('../core/path');
const { buildProjectConfig } = require('../config/build-config');
const { resolvePresetComponents } = require('../definitions/resolver');
const { buildResolver } = require('../cli/resolver-factory');
const { generateGitignore } = require('../generator');
const { listTrackedIgnoredFiles, removeCachedFiles } = require('../git');
const { analyzeGitignore } = require('./analyze');
const { formatMatchedComponentsTable } = require('./_format');

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
    throw new Error('--remove-cached requires --apply so cached file removal uses the generated .gitignore');
  }

  const distRoot = options.distRoot || DIST_ROOT;
  const warnings = [];

  // Create resolver once — reused throughout
  const resolver = buildResolver({ options, projectDirHint: projectPath });

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
      stdout.write(formatMatchedComponentsTable(analysis.displayMatchedComponents));
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
    try {
      const presetComponents = resolvePresetComponents(resolver, options.preset);

      // Find components in the preset that are NOT already fully present in the
      // current .gitignore. A 'full' classification only means >=80% overlap, so a
      // component can be classified full yet still have rules the preset would add;
      // treat a component as already covered only when every one of its rules is
      // present (matched.length === total).
      const newComponents = presetComponents.filter(id => {
        const match = analysis.matchedComponents.find(c => c.id === id);
        return !match || match.matched.length < match.total;
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

    // Deduplicate (some .gitignore files have the same rule twice). Reuse the
    // lines the analysis already parsed instead of re-reading the file.
    const seen = new Set();
    const customRules = [];
    const existingRules = analysis.inputLines;
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
  const gitignore = await generateGitignore({ config, resolver });
  const gitignorePath = path.join(projectPath, '.gitignore');

  // Show preview in console
  stdout.write(`\n--- Preview ---\n`);
  stdout.write(gitignore);
  stdout.write(`--- End preview ---\n\n`);

  // Confirm before writing (if env.confirm provided)
  if (env.confirm) {
    const proceed = await env.confirm();
    if (!proceed) {
      stdout.write('Cancelled — no files written.\n');
      return { projectPath, configPath: null, cachedRemoval: { action: 'skipped', files: [] }, analysis, warnings };
    }
  }

  // Backup existing .gitignore before overwriting
  if (fs.existsSync(gitignorePath)) {
    const backupPath = path.join(projectPath, '.gitignore.bak');
    fs.copyFileSync(gitignorePath, backupPath);
    stdout.write(`Backup saved to .gitignore.bak\n`);
  }

  writeJson(configPath, config);
  fs.writeFileSync(gitignorePath, gitignore, 'utf8');

  stdout.write(`Generated .gitignore\n`);

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
