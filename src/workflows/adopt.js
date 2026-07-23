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
const { analyzeGitignore, tryAnalyzeGitignore } = require('./analyze');
const { normalizePattern, normalizePatternExpanded, parseSignificantLines } = require('../core/text');
const { writeMatchedComponentsBlock } = require('./_format');
const { debugError } = require('../core/debug');
const { extractStreams } = require('../core/env');
const { pickExtraComponents } = require('../interactive/create');

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
 * @param {boolean} [options.overwriteConfig] - Skip the "overwrite config?" question
 * @param {boolean} [options.preview] - Skip the "show preview?" question, show directly
 * @param {boolean} [options.removeCached] - Remove Git-tracked files that should be ignored
 * @param {boolean} [options.dryRun] - Preview only, don't write or remove files
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
    throw new Error(`Project path does not exist: ${projectPath}. Use 'ignorekit init' to create a new project.`);
  }

  const distRoot = options.distRoot || process.env.IGNOREKIT_DIST_ROOT || DIST_ROOT;
  const warnings = [];

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
    analysis = tryAnalyzeGitignore({
      gitignorePath: existingGitignorePath,
      distRoot,
      userRoot: options.userRoot,
      workspaceRoot: options.workspaceRoot,
      projectPath,
      // Ask analyzeGitignore to preserve the source byte text of each rule so
      // custom-rule carry-forward below keeps the user's original line exactly
      // (including trailing whitespace and quoting).
      keepRawLines: true
    }, { stdout, stderr, cwd }, 'adopt.analyze');

    if (analysis === null) {
      // The outer `if (fs.existsSync(existingGitignorePath))` already confirmed
      // the file exists, so the analysis failure means the file is present but
      // unparseable. Custom rules cannot be carried forward — surface this
      // explicitly.
      stderr.write('Proceeding without analysis.\n');
      const warning = 'Could not analyze existing .gitignore -- custom rules will NOT be carried forward.';
      warnings.push(warning);
      stderr.write(`${warning}\n`);
    }

    if (analysis) {
      stdout.write('Analyzing existing .gitignore...\n\n');

      if (analysis.displayMatchedComponents.length > 0) {
        writeMatchedComponentsBlock(analysis.displayMatchedComponents, { stdout });
      }

      // Compare chosen preset against analysis. The preset was already
      // validated above (before the analysis section), so presetComponents
      // is guaranteed to be resolved.
      //
      // Build a map: normalized rule key → component ID that covers it.
      // This lets us annotate unmatched lines as "covered by preset" or
      // "covered by extra component" instead of lumping them all under
      // "custom rules". A line like `.DS_Store` may be unmatched by any
      // component in the analysis (platform/macos wasn't matched because
      // its ratio was too low), but the preset includes platform/macos
      // and its rules cover it.
      const ruleToComponent = new Map();
      function addComponentRules(id) {
        const r = analysis.componentResults.get(id);
        if (r) {
          for (const line of r.matched) {
            for (const expanded of normalizePatternExpanded(line)) {
              if (!ruleToComponent.has(expanded)) ruleToComponent.set(expanded, id);
            }
          }
        }
        if (!r) {
          try {
            const content = resolver.readComponent(id);
            for (const line of parseSignificantLines(content)) {
              for (const expanded of normalizePatternExpanded(line)) {
                if (!ruleToComponent.has(expanded)) ruleToComponent.set(expanded, id);
              }
            }
          } catch (err) {
            debugError(err, 'adopt.ruleToComponent', env);
          }
        }
      }
      // Seed with preset components.
      for (const id of presetComponents) {
        addComponentRules(id);
      }

      // Find components in the preset that are NOT already fully present in the
      // current .gitignore. A 'full' classification only means >=80% overlap, so a
      // component can be classified full yet still have rules the preset would add;
      // treat a component as already covered only when every one of its rules is
      // present (matched.length === total).
      const newComponents = presetComponents.filter(id => {
        const match = analysis.matchedComponents.find(c => c.id === id);
        return !match || match.matched.length < match.total;
      });

      // Find matched components NOT in the chosen preset (will be lost if not in custom).
      // Include both full and partial matches — the user decides interactively.
      const presetSet = new Set(presetComponents);
      const lostComponents = analysis.matchedComponents.filter(c => (c.classification === 'full' || c.classification === 'partial') && !presetSet.has(c.id));

      if (newComponents.length > 0) {
        stdout.write(`Preset "${options.preset}" will add ${newComponents.length} new component(s):\n`);
        for (const id of newComponents) {
          stdout.write(`  ${id}\n`);
        }
        stdout.write('\n');
      }

      if (lostComponents.length > 0) {
        const lostWarning = `Detected ${lostComponents.length} component(s) in .gitignore not in preset "${options.preset}"`;
        warnings.push(lostWarning);

        // Interactive: let user pick which to add (full matches pre-selected, partial opt-in)
        const selectedIds = await pickExtraComponents(lostComponents, { stdout, stderr, ask: env.ask, stdin: env.stdin });
        if (selectedIds.length > 0) {
          if (!options.components) options.components = [];
          for (const id of selectedIds) {
            if (!options.components.includes(id)) {
              options.components.push(id);
              // Register extra component rules in ruleToComponent so the
              // custom-rules display can annotate them as covered.
              addComponentRules(id);
            }
          }
          stdout.write(`Added ${selectedIds.length} extra component(s): ${selectedIds.join(', ')}\n`);
        } else {
          stdout.write('No extra components added.\n');
        }
      }

      // Display unmatched lines, annotated with which component covers them.
      if (analysis.displayedUnmatchedLines.length > 0) {
        const coveredLines = [];
        const trulyCustom = [];
        for (const line of analysis.displayedUnmatchedLines) {
          const expanded = normalizePatternExpanded(line);
          const coveringComponent = expanded.length > 0
            ? expanded.map(e => ruleToComponent.get(e)).find(c => c !== undefined)
            : undefined;
          if (coveringComponent) {
            coveredLines.push({ line, component: coveringComponent });
          } else {
            trulyCustom.push(line);
          }
        }

        if (trulyCustom.length > 0) {
          stdout.write(`Custom rules (${trulyCustom.length}):\n`);
          for (const line of trulyCustom) {
            stdout.write(`  ${line}\n`);
          }
          stdout.write('\n');
        }

        if (coveredLines.length > 0) {
          stdout.write(`Covered by selected components (${coveredLines.length}):\n`);
          for (const { line, component } of coveredLines) {
            stdout.write(`  ${line}  (${component})\n`);
          }
          stdout.write('\n');
        }
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
    const excludeSet = new Set(options.exclude || []);
    const selectedComponentIds = new Set([
      ...(options.components || []),
      ...presetComponents.filter(id => !excludeSet.has(id))
    ]);
    // Build the covered-rule set using trimmed keys so that whitespace
    // differences between the component file and the user's .gitignore do
    // not prevent a match. A rule like "logs/" in the component covers
    // "logs/   " in the source .gitignore because they normalize to the
    // same key. Bracket expressions are expanded so that `*.py[cod]` in
    // the component covers `*.pyc` in the user's .gitignore.
    const coveredRules = new Set();
    for (const id of selectedComponentIds) {
      const result = analysis.componentResults.get(id);
      if (result) {
        for (const line of result.matched) {
          for (const expanded of normalizePatternExpanded(line)) {
            coveredRules.add(expanded);
          }
        }
      } else {
        // Component has zero overlap with the existing .gitignore (not in
        // componentResults). Its rules are still "covered" by the selection
        // and must not be duplicated in config.custom. Resolve the component
        // content and add all its rules to coveredRules.
        try {
          const content = resolver.readComponent(id);
          for (const line of parseSignificantLines(content)) {
            for (const expanded of normalizePatternExpanded(line)) {
              coveredRules.add(expanded);
            }
          }
        } catch (err) {
          // Component may not exist or be unreadable — skip gracefully.
          // If the component is missing, the generator will also skip it,
          // so there is no duplication risk.
          debugError(err, 'adopt.coveredRules', env);
        }
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
    const sourceLines = analysis.originalLines || analysis.inputLines;
    for (const line of sourceLines) {
      // Check all expanded forms against coveredRules so that `*.pyc`
      // is recognized as covered by `*.py[cod]`.
      const expanded = normalizePatternExpanded(line);
      const isCovered = expanded.some(form => coveredRules.has(form));
      const key = normalizePattern(line);
      if (!isCovered && !seen.has(key)) {
        seen.add(key);
        customRules.push(line);
      }
    }
    config.custom = customRules;
  }

  // Generate .gitignore
  const gitignore = await generateGitignore({ config, resolver, env });
  const gitignorePath = path.join(projectPath, '.gitignore');
  const configPath = path.join(projectPath, 'ignorekit.json');

  if (options.dryRun) {
    stdout.write(`\n--- Preview (ignorekit.json) ---\n`);
    stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    stdout.write(`--- End preview ---\n\n`);
    stdout.write(`--- Preview (.gitignore) ---\n`);
    stdout.write(gitignore);
    stdout.write(`--- End preview ---\n\n`);
    stdout.write('Dry run -- no files written or Git index changes made.\n');
    return { projectPath, configPath, cachedRemoval: { action: 'skipped', files: [] }, analysis, warnings, dryRun: true };
  }

  // STEP 1: Confirm writing ignorekit.json. When it already exists, the
  // question is phrased as an overwrite. When --overwrite-config is passed
  // the question is skipped. In non-interactive mode (no env.ask), an
  // existing config requires the flag explicitly. Declining the config
  // aborts the entire operation — both config and .gitignore are skipped.
  if (fs.existsSync(configPath) && !options.overwriteConfig) {
    if (env.ask) {
      const overwrite = await env.ask('Overwrite existing ignorekit.json? [Y/n]: ');
      if (overwrite && overwrite.trim().toLowerCase() === 'n') {
        stdout.write('Aborted — no files written.\n');
        return { projectPath, configPath: null, cachedRemoval: { action: 'skipped', files: [] }, analysis, warnings };
      }
    } else {
      throw new Error(`Config already exists: ${configPath}. Use --overwrite-config to replace.`);
    }
  }

  writeJson(configPath, config);
  stdout.write(`Wrote ${configPath}\n`);

  // STEP 2: Preview the generated .gitignore. When --preview is passed, show
  // the preview directly. When the flag is NOT passed, ask interactively. In
  // non-interactive mode (no env.ask), skip the preview entirely.
  if (options.preview) {
    stdout.write(`\n--- Preview (.gitignore) ---\n`);
    stdout.write(gitignore);
    stdout.write(`--- End preview ---\n\n`);
  } else if (env.ask) {
    const showPreview = await env.ask('Show preview of generated .gitignore? [Y/n]: ');
    if (!showPreview || showPreview.trim().toLowerCase() !== 'n') {
      stdout.write(`\n--- Preview (.gitignore) ---\n`);
      stdout.write(gitignore);
      stdout.write(`--- End preview ---\n\n`);
    } else {
      stdout.write('Preview skipped.\n');
    }
  }

  // STEP 3: Confirm overwriting .gitignore. Only asked when a .gitignore
  // already exists — a new file is written without asking. This is a separate
  // question from ignorekit.json so the user may update the config while
  // keeping their hand-written .gitignore. --confirm skips the prompt.
  // Non-interactive mode (no env.confirm) proceeds without asking.
  let writeGitignore = true;
  if (fs.existsSync(gitignorePath) && env.confirm && !options.confirm) {
    const proceed = await env.confirm('Overwrite existing .gitignore? [Y/n]: ');
    if (!proceed) writeGitignore = false;
  }

  if (writeGitignore) {
    fs.writeFileSync(gitignorePath, gitignore, 'utf8');
    stdout.write(`Generated .gitignore at ${gitignorePath}\n`);
  } else {
    stdout.write('Skipped .gitignore.\n');
  }

  // Handle cached file removal. --remove-cached is an explicit opt-in, so it
  // removes for real. Dry-run exits above before touching Git's index.
  let cachedRemoval = { action: 'skipped', files: [] };
  if (options.removeCached && writeGitignore) {
    const files = listTrackedIgnoredFiles(projectPath);
    cachedRemoval = removeCachedFiles(projectPath, files, { dryRun: options.dryRun });
    if (cachedRemoval.action === 'dry-run' && cachedRemoval.files.length > 0) {
      stdout.write('Files that would be removed from Git index:\n');
      for (const file of cachedRemoval.files) {
        stdout.write(`  ${file}\n`);
      }
    } else if (cachedRemoval.action === 'removed') {
      stdout.write(`Removed ${cachedRemoval.files.length} file(s) from Git index\n`);
    }
  } else if (options.removeCached) {
    stdout.write('Skipped --remove-cached because .gitignore was not written.\n');
  }

  return { projectPath, configPath, cachedRemoval, analysis, warnings };
}

module.exports = { runAdoptWorkflow };
