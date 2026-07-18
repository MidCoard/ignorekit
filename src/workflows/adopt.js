'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { DIST_ROOT } = require('../core/path');
const { buildProjectConfig } = require('../config/build-config');
const { resolvePresetComponents } = require('../definitions/resolver');
const { buildResolver } = require('../core/resolver-factory');
const { generateGitignore } = require('../generator');
const { listTrackedIgnoredFiles, removeCachedFiles } = require('../git');
const { analyzeGitignore } = require('./analyze');
const { normalizePattern } = require('../core/text');
const { writeMatchedComponentsBlock } = require('./_format');
const { debugError } = require('../core/debug');
const { extractStreams } = require('../core/env');

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
  const { stdout, stderr, cwd } = extractStreams(env);
  const projectPath = path.resolve(cwd, options.projectPath);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  if (options.removeCached && !options.apply) {
    throw new Error('--remove-cached requires --apply (which writes .gitignore and ignorekit.json) so cached file removal uses the generated .gitignore');
  }

  const distRoot = options.distRoot || DIST_ROOT;
  const warnings = [];

  // Overwrite-guard fires BEFORE any analysis or preview. A user who already
  // has an ignorekit.json on disk should learn "config exists" first; running
  // the analysis (which reads + matches their .gitignore, then prints "Rules
  // needing review" and "Preset will add N components") only to throw on a
  // config check at the end is wasted work and produces misleading output.
  // Adopt uses --overwrite-config (not --overwrite) because the .gitignore
  // overwrite is gated by --apply separately — the two overwrite decisions
  // must be independent. Init uses --overwrite for both because it creates
  // both files from scratch. Renaming either flag would be a breaking change.
  const configPath = path.join(projectPath, 'ignorekit.json');
  if (fs.existsSync(configPath) && !options.overwriteConfig) {
    throw new Error(`Config already exists: ${configPath}. Use --overwrite-config to replace.`);
  }

  // Create resolver once — reused throughout
  const resolver = buildResolver({ options, env, projectDirHint: projectPath });

  // Validate the preset BEFORE any analysis or preview. A missing preset must
  // error immediately — showing "Analyzing existing .gitignore" and "Preset
  // will add N components" for a preset that doesn't exist is misleading.
  // The resolved components are cached for reuse in the analysis comparison
  // and custom-rule carry-forward below.
  const presetComponents = resolvePresetComponents(resolver, options.preset);

  // Analyze existing .gitignore if present.
  // The analysis can fail for pathological inputs (e.g. a .gitignore past the
  // 1 MiB size guard). When that happens, degrade gracefully: skip the analysis
  // section and proceed with the config build. The user still gets a working
  // config and .gitignore — they just miss the matched-component preview and
  // the custom-rule carry-forward (which falls back to empty).
  let analysis = null;
  const existingGitignorePath = path.join(projectPath, '.gitignore');
  if (fs.existsSync(existingGitignorePath)) {
    try {
      analysis = analyzeGitignore({
        gitignorePath: existingGitignorePath,
        distRoot,
        userRoot: options.userRoot,
        workspaceRoot: options.workspaceRoot,
        projectPath,
        // Ask analyzeGitignore to preserve the source byte text of each rule so
        // custom-rule carry-forward below keeps the user's original line exactly
        // (including trailing whitespace and quoting).
        keepRawLines: true
      }, { stderr: env.stderr });
    } catch (err) {
      stderr.write(`Could not analyze existing .gitignore: ${err.message}\n`);
      stderr.write('Proceeding without analysis.\n');
      debugError(err, 'adopt.analyze', env);
    }

    if (analysis) {
      stdout.write('Analyzing existing .gitignore...\n\n');

      if (analysis.displayMatchedComponents.length > 0) {
        writeMatchedComponentsBlock(analysis.displayMatchedComponents, { stdout });
      }

      if (analysis.unmatchedLines.length > 0) {
        stdout.write(`Rules needing review (${analysis.unmatchedLines.length}):\n`);
        for (const line of analysis.unmatchedLines) {
          stdout.write(`  ${line}\n`);
        }
        stdout.write('\n');
      }

      // Compare chosen preset against analysis. The preset was already
      // validated above (before the analysis section), so presetComponents
      // is guaranteed to be resolved.

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
    }
  }

  // Build and write config
  const config = buildProjectConfig(path.basename(projectPath), options);

  // Keep only rules that the chosen preset and extra components do not cover.
  // resolvePresetComponents errors propagate before the config is built — a
  // missing preset must not silently produce wrong custom rules.
  if (analysis) {
    const selectedComponentIds = new Set([...(options.components || []), ...presetComponents]);
    // Build the covered-rule set using trimmed keys so that whitespace
    // differences between the component file and the user's .gitignore do
    // not prevent a match. A rule like "logs/" in the component covers
    // "logs/   " in the source .gitignore because they normalize to the
    // same key.
    const coveredRules = new Set();
    for (const id of selectedComponentIds) {
      const result = analysis.componentResults.get(id);
      if (result) {
        for (const line of result.matched) coveredRules.add(normalizePattern(line));
      }
    }

    // Deduplicate using trimmed keys so rules that differ only in whitespace
    // are treated as the same rule. Prefer the original byte text —
    // `originalLines` preserves trailing whitespace and quoting;
    // `inputLines` is the normalized form used for matching. When analysis
    // was run without keepRawLines, fall back to inputLines so older
    // callers still produce byte-identical output to before.
    const seen = new Set();
    const customRules = [];
    const existingRules = analysis.originalLines || analysis.inputLines;
    for (const line of existingRules) {
      const key = normalizePattern(line);
      if (!coveredRules.has(key) && !seen.has(key)) {
        seen.add(key);
        customRules.push(line);
      }
    }
    config.custom = customRules;
  }

  // Generate .gitignore
  const gitignore = await generateGitignore({ config, resolver, env });
  const gitignorePath = path.join(projectPath, '.gitignore');

  // Show preview in console
  stdout.write(`\n--- Preview ---\n`);
  stdout.write(gitignore);
  stdout.write(`--- End preview ---\n\n`);

  // Without --apply, adopt is a dry run: preview only, no files written.
  // The --apply flag is the safety gate that turns the preview into actual
  // writes. This matches the documented contract: "adopt writes directly to
  // .gitignore" only when the user explicitly opts in with --apply.
  //
  // Preview mode returns exit code 0 because the command succeeded at its
  // stated purpose (showing the user what would change). Exit 1 is reserved
  // for errors and user cancellations, not for "no files written" which is
  // the expected outcome of a dry run. The `preview: true` field in the
  // return value lets programmatic callers distinguish preview from write.
  if (!options.apply) {
    stdout.write('Preview mode — no files written. Use --apply to write.\n');
    return { projectPath, configPath: null, cachedRemoval: { action: 'skipped', files: [] }, analysis, warnings, preview: true };
  }

  // Confirm before writing (if env.confirm provided)
  if (env.confirm) {
    const proceed = await env.confirm();
    if (!proceed) {
      stdout.write('Cancelled — no files written.\n');
      return { projectPath, configPath: null, cachedRemoval: { action: 'skipped', files: [] }, analysis, warnings };
    }
  }

  // Backup existing .gitignore before overwriting. Skip backup if a previous
  // backup already exists — overwriting it would destroy the user's original
  // file from a prior adopt run. The user can manually delete .gitignore.bak
  // if they want a fresh backup.
  if (fs.existsSync(gitignorePath)) {
    const backupPath = path.join(projectPath, '.gitignore.bak');
    if (fs.existsSync(backupPath)) {
      stdout.write(`Skipping backup — .gitignore.bak already exists (preserving previous backup)\n`);
    } else {
      fs.copyFileSync(gitignorePath, backupPath);
      stdout.write(`Backup saved to .gitignore.bak\n`);
    }
  }

  writeJson(configPath, config);
  // Non-atomic write: a crash between these two writes could leave an
  // ignorekit.json pointing to an unwritten .gitignore. This is acceptable
  // because (a) the backup preserves the user's original .gitignore, and
  // (b) re-running adopt restores the correct state. An atomic
  // write-to-temp-then-rename would add filesystem-specific complexity
  // (Windows doesn't support rename over an existing file) for a scenario
  // that is both rare and recoverable.
  fs.writeFileSync(gitignorePath, gitignore, 'utf8');

  stdout.write(`Generated .gitignore\n`);

  // Handle cached file removal
  let cachedRemoval = { action: 'skipped', files: [] };
  if (options.removeCached) {
    const files = listTrackedIgnoredFiles(projectPath);
    // --yes combined with --remove-cached upgrades the removal from dry-run to
    // live. This is intentional (--yes means "skip all prompts"), but the
    // upgrade from "show what would be removed" to "actually remove" is
    // significant enough to warrant an explicit notice so the user isn't
    // surprised by files disappearing from the Git index.
    if (options.yes && files.length > 0) {
      stdout.write(`Removing ${files.length} file(s) from Git index (--yes confirms live removal)\n`);
    }
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
