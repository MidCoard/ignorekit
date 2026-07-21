'use strict';

const fs = require('fs');
const path = require('path');
const { assertDefinitionId, resolveInside, USER_ROOT } = require('../core/path');
const { normalizeText, parseSignificantLines } = require('../core/text');
const { analyzeGitignore, tryAnalyzeGitignore } = require('./analyze');
const { writeMatchedComponentsBlock } = require('./_format');
const { extractStreams } = require('../core/env');

function assertSegment(value, label) {
  if (!value || typeof value !== 'string' || value.includes('/')) {
    throw new Error(`${label} must be a single name, without '/'.`);
  }
  assertDefinitionId(value);
}

/**
 * Run the component creation workflow.
 *
 * Smart extraction is the default behavior:
 * - When --from <path> is set, the source is analyzed against known components
 *   and only the unmatched (custom) lines are extracted as the new component.
 * - When --rule <pattern> is set (with or without --from), the user has explicit
 *   rules and they are used directly (no analysis).
 * - When neither is set, callers should have collected rules via interactive prompts.
 *
 * If env.confirm is provided (a function returning a Promise<boolean>), it is
 * invoked after the preview is shown. The file is only written if confirm returns true.
 *
 * @param {object} options
 * @param {string} options.category - Component category (e.g. 'local', 'framework')
 * @param {string} options.name - Component name (e.g. 'runtime')
 * @param {string} [options.from] - Path to a source .gitignore file (smart analysis applied)
 * @param {string[]} [options.rules] - Explicit rules (skips analysis if provided)
 * @param {string} [options.outputRoot] - Output directory (default: ~/.ignorekit)
 * @param {boolean} [options.overwrite] - Replace an existing component
 * @param {string} [options.distRoot] - Override dist root for analysis
 * @param {string} [options.userRoot] - User-level override directory for analysis
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory for analysis
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {string} [env.cwd] - Current working directory
 * @param {Function} [env.confirm] - Async function returning boolean; false skips write
 * @returns {{ id: string, outputPath: string|null, rules: string[], analysis: object|null, warnings: string[] }}
 */
async function runComponentCreate(options, env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  assertSegment(options.category, 'category');
  assertSegment(options.name, 'component name');

  const outputRoot = options.outputRoot
    ? path.resolve(cwd, options.outputRoot)
    : USER_ROOT;
  const id = `${options.category}/${options.name}`;
  const outputPath = resolveInside(outputRoot, path.join('components', `${id}.gitignore`));
  if (fs.existsSync(outputPath) && !options.overwrite) {
    throw new Error(`Component already exists: ${outputPath}. Use --overwrite to replace it.`);
  }

  // --user-root only affects discovery. Without an explicit --output-root the
  // file lands in the user's personal definitions layer (~/.ignorekit), which
  // is the default. Surface that explicitly so users on a team-shared user
  // root (--user-root /shared/team-defs) aren't surprised when their component
  // doesn't show up next to the rest of their discovery sources. Use the
  // `_userRootExplicit` flag set by applyUserRootDefault so the warning only
  // fires when the user actually typed --user-root — the silent default
  // would otherwise produce a confusing note on every create.
  if (options._userRootExplicit && !options.outputRoot) {
    stderr.write(`Note: --user-root is a discovery source. Without --output-root, the file is written to ${USER_ROOT} (the default user definitions layer).\n`);
    stderr.write(`      Pass --output-root to write somewhere else.\n`);
  }

  let rules = Array.isArray(options.rules) ? options.rules : [];
  const warnings = [];
  let analysis = null;

  // Smart extraction: --from with no explicit --rule → analyze + take unmatched lines.
  // The analysis can fail for pathological inputs (e.g. a .gitignore past the
  // 1 MiB size guard). When that happens, the component cannot be extracted
  // automatically — surface the error so the user can use --rule instead.
  if (options.from && rules.length === 0) {
    const sourcePath = path.resolve(cwd, options.from);
    analysis = tryAnalyzeGitignore({
      gitignorePath: sourcePath,
      distRoot: options.distRoot,
      userRoot: options.userRoot,
      workspaceRoot: options.workspaceRoot,
      // The source .gitignore may be outside the project root (e.g. --from
      // pointing to an arbitrary file). Signal detection must run against the
      // actual project directory, not the directory containing the source file.
      projectPath: cwd
    }, { stdout, stderr, cwd }, 'component.analyze');

    if (analysis === null) {
      stderr.write('Use --rule to specify rules explicitly, or use a smaller source file.\n');
      throw new Error(`Cannot analyze source file: ${path.basename(sourcePath)}`);
    }

    stdout.write(`Analyzing ${path.basename(sourcePath)} before extraction...\n\n`);

    if (analysis.matchedComponents.length > 0) {
      writeMatchedComponentsBlock(analysis.matchedComponents, { stdout });
    }

    rules = analysis.unmatchedLines;

    if (rules.length === 0) {
      stdout.write('All lines are already covered by known components.\n');
      stdout.write('Nothing to extract. Pass --rule for explicit rules or use a different source file.\n');
      return { id, outputPath: null, rules: [], analysis, warnings };
    }

    // Warn about partial matches
    const partialMatches = analysis.matchedComponents.filter(c => c.classification === 'partial');
    if (partialMatches.length > 0) {
      warnings.push(
        `${partialMatches.length} component(s) are partially matched. ` +
        `If you adopt a preset containing these components, the generated .gitignore ` +
        `will include additional rules not in your current .gitignore:`
      );
      for (const comp of partialMatches) {
        if (comp.unmatched.length > 0) {
          warnings.push(`  ${comp.id}: adds ${comp.unmatched.join(', ')}`);
        }
      }
    }

    // Warn about fully matched components that will be duplicated
    const fullMatches = analysis.matchedComponents.filter(c => c.classification === 'full');
    if (fullMatches.length > 0) {
      warnings.push(
        `${fullMatches.length} component(s) are fully matched. ` +
        `Rules from these components appear in both the extracted component and the original components. ` +
        `Use ignorekit.json with the matching preset instead of the extracted component to avoid duplication.`
      );
    }

    // Suggest best preset if available
    if (analysis.bestPreset && analysis.bestPreset.score > 0) {
      stdout.write(`Suggestion: consider using preset "${analysis.bestPreset.id}" which covers ${analysis.bestPreset.fullCount}/${analysis.bestPreset.componentCount} matched components.\n`);
      stdout.write(`  You can then add the extracted component as an extra component in ignorekit.json.\n\n`);
    }
  }

  if (rules.some(rule => typeof rule !== 'string' || rule.length === 0)) {
    throw new Error('component rules must be non-empty strings');
  }

  // Preview before writing
  stdout.write(`\nComponent: ${id}\n`);
  stdout.write(`Rules (${rules.length}):\n`);
  for (let i = 0; i < rules.length; i += 1) {
    stdout.write(`  ${i + 1}. ${rules[i]}\n`);
  }
  stdout.write(`Output: ${outputPath}\n`);

  if (env.confirm) {
    const proceed = await env.confirm();
    if (!proceed) {
      stdout.write('Cancelled — no file written.\n');
      return { id, outputPath: null, rules, analysis, warnings };
    }
  }

  // Build content (smart extraction adds a header explaining what was extracted)
  let content;
  if (analysis) {
    const sourceName = path.basename(path.resolve(cwd, options.from));
    const headerLine = `# Extracted from ${sourceName} (unmatched rules only)`;
    content = normalizeText([headerLine, ...rules].join('\n'));
  } else {
    content = normalizeText(rules.join('\n'));
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');

  // Print results
  if (analysis) {
    stdout.write(`\nExtracted component ${id} (${rules.length} rules) → ${outputPath}\n`);
    stdout.write(`  ${analysis.matchedComponents.reduce((s, c) => s + c.matched.length, 0)} rule(s) already covered by known components (not extracted)\n`);
  } else {
    stdout.write(`\nCreated component ${id} (${rules.length} rules) → ${outputPath}\n`);
  }

  if (!options.outputRoot) {
    stdout.write(`  Component is available to all projects via the user definitions layer.\n`);
  }

  if (warnings.length > 0) {
    stdout.write('\nWarnings:\n');
    for (const w of warnings) {
      stdout.write(`  ${w}\n`);
    }
    stdout.write('\n');
  }

  return { id, outputPath, rules, analysis, warnings };
}

module.exports = { runComponentCreate };