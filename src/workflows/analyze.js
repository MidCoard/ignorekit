'use strict';

const fs = require('fs');
const path = require('path');
const { parseSignificantLines, normalizePattern, normalizePatternExpanded } = require('../core/text');
const { resolvePresetComponents } = require('../definitions/resolver');
const { buildResolver } = require('../core/resolver-factory');
const { DIST_ROOT } = require('../core/path');
const { detectProjectSignals } = require('../detection/project-signals');
const { formatMatchedComponentsTable, ID_PAD } = require('./_format');
const { debugError } = require('../core/debug');
const { MAX_CONTENT_BYTES } = require('../core/constants');
const { extractStreams } = require('../core/env');

/**
 * Compute match result for a component against input lines.
 * @param {Iterable<string>} inputLines - Normalized significant lines from the input .gitignore
 * @param {string} componentContent - Raw content of the component
 * @returns {{ matched: string[], unmatched: string[], total: number, ratio: number, positiveMatched: number }}
 */
function matchComponent(inputLines, componentContent) {
  const componentLines = parseSignificantLines(componentContent);
  // Build a normalized lookup set from input lines, expanding bracket
  // expressions so that `*.pyc` matches `*.py[cod]`, `Desktop.ini` matches
  // `[Dd]esktop.ini`, etc. Each input line contributes all its expanded
  // forms to the set.
  const normalizedInput = new Set();
  for (const line of inputLines) {
    for (const expanded of normalizePatternExpanded(line)) {
      normalizedInput.add(expanded);
    }
  }
  const matched = [];
  const unmatched = [];
  for (const line of componentLines) {
    // Check if any expanded form of the component line matches an input line.
    // This handles both directions: `*.py[cod]` in the component matches
    // `*.pyc` in the input, and `*.swp` in the input matches `*.sw?` in
    // the component.
    const componentExpanded = normalizePatternExpanded(line);
    const isMatch = componentExpanded.some(form => normalizedInput.has(form));
    if (isMatch) {
      matched.push(line);
    } else {
      unmatched.push(line);
    }
  }
  // Negation lines (!...) are structural complements to positive patterns,
  // not independent rules a user would typically write. Exclude them from
  // the ratio denominator so that components with negation patterns (e.g.
  // language/java with 4 negation lines out of 7 total) are not penalized
  // for lines that inflate the denominator and deflate the match ratio.
  // The matched/unmatched arrays still contain negation lines so that
  // coverage tracking and pattern-equivalence checks work correctly.
  const positiveLines = componentLines.filter(line => !line.trim().startsWith('!'));
  const positiveMatched = matched.filter(line => !line.trim().startsWith('!'));
  const total = positiveLines.length;
  const ratio = total > 0 ? positiveMatched.length / total : 0;
  return { matched, unmatched, total, ratio, positiveMatched: positiveMatched.length };
}

const FULL_MATCH_THRESHOLD = 0.8;
const PARTIAL_MATCH_THRESHOLD = 0.3;

/**
 * Classify a match ratio.
 * @param {number} ratio
 * @returns {'full'|'partial'|'none'}
 */
function classifyMatch(ratio) {
  if (ratio >= FULL_MATCH_THRESHOLD) return 'full';
  if (ratio >= PARTIAL_MATCH_THRESHOLD) return 'partial';
  return 'none';
}

/**
 * Score a preset based on how many of its components match the input.
 *
 * Two main factors:
 * 1. Input coverage — how many of the input .gitignore's rules are
 *    explained by this preset's matched components (count and percentage).
 *    This rewards presets that cover more of what the user actually has.
 * 2. Added rules — how many NEW rules this preset would introduce that
 *    aren't in the current .gitignore. This penalizes presets that would
 *    add noise.
 *
 * @param {string[]} presetComponents - Component IDs in the preset
 * @param {Map<string, object>} componentResults - Match results keyed by component ID
 * @param {number} totalInputLines - Total significant lines in the input .gitignore
 * @returns {{ score: number, fullCount: number, partialCount: number, missCount: number }}
 */
function scorePreset(presetComponents, componentResults, totalInputLines = 0) {
  let fullCount = 0;
  let partialCount = 0;
  let missCount = 0;
  let matchedLineCount = 0;
  let addedRuleCount = 0;
  for (const id of presetComponents) {
    const result = componentResults.get(id);
    if (!result) { missCount++; continue; }
    const cls = classifyMatch(result.ratio);
    // All matched lines count toward input coverage, regardless of classification.
    // Full matches count at full weight, partial at half, and even "none" matches
    // (below threshold) still cover some input lines — count at quarter weight.
    const WEIGHT_FULL = 1.0;
    const WEIGHT_PARTIAL = 0.5;
    const WEIGHT_NONE = 0.25;
    if (cls === 'full') {
      fullCount++;
      matchedLineCount += result.matched.length * WEIGHT_FULL;
      addedRuleCount += result.unmatched.length;
    } else if (cls === 'partial') {
      partialCount++;
      matchedLineCount += result.matched.length * WEIGHT_PARTIAL;
      addedRuleCount += result.unmatched.length;
    } else {
      missCount++;
      // A "none"-classified component (ratio < 30%) still has some matched lines.
      // The 0.25 weight gives partial credit so that a preset with many weakly-
      // matching components can still outscore one with fewer but stronger matches
      // when the weak matches collectively cover more of the input. This is a
      // scoring heuristic, not a correctness property — the weight is low enough
      // that a single spurious match cannot inflate a preset's score meaningfully,
      // but high enough that a preset whose 20 components each match 1-2 lines
      // accumulates real coverage credit. Only the unmatched lines are genuinely
      // "added" noise; the matched lines are already in the input and must not
      // be double-penalized.
      matchedLineCount += result.matched.length * WEIGHT_NONE;
      addedRuleCount += result.unmatched.length;
    }
  }
  const total = presetComponents.length;

  // Factor 1: Input coverage percentage (how much of the .gitignore this preset explains)
  const inputCoverage = totalInputLines > 0 ? matchedLineCount / totalInputLines : 0;

  // Factor 2: Component completeness (fraction of preset components fully matched)
  const completeness = total > 0 ? fullCount / total : 0;

  // Scoring weights — named constants for clarity
  const SCORE_INPUT_COVERAGE = 400;
  const SCORE_COMPLETENESS = 150;
  const SCORE_MATCHED_LINES = 25;
  const PENALTY_ADDED_RULES = 2;

  // Final score: input coverage and matched line count are the primary signals,
  // completeness measures structural fit, added rules penalize noise.
  // Floor at 0 to avoid confusing negative scores in a "best match" context.
  const score = Math.max(0, Math.round(
    inputCoverage * SCORE_INPUT_COVERAGE +
    completeness * SCORE_COMPLETENESS +
    matchedLineCount * SCORE_MATCHED_LINES -
    addedRuleCount * PENALTY_ADDED_RULES
  ));
  return { score, fullCount, partialCount, missCount };
}

/**
 * Core analysis logic — no side effects. Reusable by extract and adopt.
 *
 * The analysis pipeline is decomposed into matchAllComponents (component
 * matching, classification, and coverage) and scoreAllPresets (preset
 * scoring with project signal detection). These are kept in the same file
 * because they share the same data flow: matchAllComponents produces
 * componentResults which scoreAllPresets consumes.
 *
 * @param {object} options
 * @param {string} options.gitignorePath - Path to the .gitignore file
 * @param {string} options.distRoot - Dist root for definitions
 * @param {string} [options.userRoot] - User-level override directory
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
 * @param {string} [options.projectPath] - Project root directory for signal detection.
 *   When absent, defaults to the directory containing the .gitignore file. Callers
 *   that supply a .gitignore from a non-project-root location (e.g. chooseRulesSmart
 *   receiving an arbitrary --from path) should pass the actual project root so that
 *   signal detection (package.json, build.gradle, etc.) scans the right directory.
 * @param {object} [env] - Environment streams
 * @param {object} [env.stderr] - Writable stream for warnings (default: process.stderr)
 * @returns {{ totalLines: number, matchedComponents: object[], unmatchedLines: string[], componentResults: Map, bestPreset: object|null, allPresets: object[], originalLines?: string[] }}
 */
function analyzeGitignore(options, env) {
  const gitignorePath = path.resolve(options.gitignorePath);
  const projectPath = options.projectPath || path.dirname(gitignorePath);
  // Guard against pathological inputs before reading the whole file into memory.
  // A .gitignore is a small text file; anything past 1 MiB is either a mistake or
  // an attempt to exhaust memory, so refuse rather than buffer it.
  // Callers that already read the source (e.g. chooseRulesSmart) may pass
  // `options.content` to skip the disk read; the size guard still applies so
  // pathological inputs are rejected even when the content is supplied
  // in-memory.
  let rawContent;
  if (typeof options.content === 'string') {
    const byteLength = Buffer.byteLength(options.content, 'utf8');
    if (byteLength > MAX_CONTENT_BYTES) {
      throw new Error(`.gitignore is too large to analyze (${byteLength} bytes, limit ${MAX_CONTENT_BYTES})`);
    }
    rawContent = options.content;
  } else {
    const stat = fs.statSync(gitignorePath);
    if (stat.size > MAX_CONTENT_BYTES) {
      throw new Error(`.gitignore is too large to analyze (${stat.size} bytes, limit ${MAX_CONTENT_BYTES})`);
    }
    rawContent = fs.readFileSync(gitignorePath, 'utf8');
  }
  // Analyze uses the trimmed form for matching; originalLines preserves the
  // user's actual byte text so callers (adopt) can carry forward rules with
  // their original whitespace and quoting intact.
  const inputLines = parseSignificantLines(rawContent);
  const originalLines = options.keepRawLines ? parseSignificantLines(rawContent, { keepRaw: true }).map(p => p.original) : null;
  const totalInputLines = inputLines.length;

  const distRoot = options.distRoot || process.env.IGNOREKIT_DIST_ROOT || DIST_ROOT;
  const resolver = buildResolver({ options, env, projectDirHint: projectPath });

  const matchResult = matchAllComponents(resolver, inputLines, env);
  const presetResult = scoreAllPresets(resolver, matchResult.componentResults, totalInputLines, projectPath, env);

  return {
    totalLines: totalInputLines,
    inputLines,
    matchedComponents: matchResult.matchedComponents,
    displayMatchedComponents: matchResult.displayMatchedComponents,
    unmatchedLines: matchResult.unmatchedLines,
    displayedUnmatchedLines: matchResult.displayedUnmatchedLines,
    componentResults: matchResult.componentResults,
    bestPreset: presetResult.bestPreset,
    allPresets: presetResult.allPresets,
    ...(originalLines ? { originalLines } : {})
  };
}

/**
 * Match all known components against the input lines.
 *
 * @param {object} resolver - Definition resolver
 * @param {string[]} inputLines - Normalized significant lines from the input .gitignore
 * @param {object} [env] - Environment streams for debug logging
 * @returns {{ componentResults: Map, matchedComponents: object[], displayMatchedComponents: object[], unmatchedLines: string[], displayedUnmatchedLines: string[], totalMatchedCount: number }}
 */
function matchAllComponents(resolver, inputLines, env) {
  const componentIds = resolver.listComponents();
  const componentResults = new Map();

  for (const id of componentIds) {
    try {
      const content = resolver.readComponent(id);
      const result = matchComponent(inputLines, content);
      if (result.matched.length > 0) {
        componentResults.set(id, result);
      }
    } catch (err) {
      debugError(err, 'analyze.readComponent', env);
      // Skip components that can't be read
    }
  }

  // Separate matched (full + partial) from none
  const matchedComponents = [];
  for (const [id, result] of componentResults) {
    const cls = classifyMatch(result.ratio);
    if (cls !== 'none') {
      matchedComponents.push({ id, ...result, classification: cls });
    }
  }

  // Sort: full matches first, then by ratio descending
  matchedComponents.sort((a, b) => {
    if (a.classification === 'full' && b.classification !== 'full') return -1;
    if (a.classification !== 'full' && b.classification === 'full') return 1;
    return b.ratio - a.ratio;
  });
  const displayMatchedComponents = matchedComponents.filter(component =>
    component.classification === 'full' || component.matched.length >= 2
  );

  // Compute matched lines coverage (use expanded normalized patterns for dedup)
  const allMatchedNormalized = new Set();
  for (const comp of matchedComponents) {
    for (const line of comp.matched) {
      for (const expanded of normalizePatternExpanded(line)) {
        allMatchedNormalized.add(expanded);
      }
    }
  }

  // Compute unmatched lines (using expanded normalized comparison)
  const unmatchedLines = inputLines.filter(line => {
    const expanded = normalizePatternExpanded(line);
    return !expanded.some(form => allMatchedNormalized.has(form));
  });

  // Unmatched lines use ALL matched components (not just displayed ones) so that
  // a rule covered by a hidden low-signal partial is not falsely reported as
  // unmatched. The display filter hides noise from the component table, but a
  // covered rule is covered regardless of whether its component is displayed.
  const displayedUnmatchedLines = inputLines.filter(line => {
    const expanded = normalizePatternExpanded(line);
    return !expanded.some(form => allMatchedNormalized.has(form));
  });

  const totalMatchedCount = matchedComponents.reduce((sum, c) => sum + c.matched.length, 0);

  return { componentResults, matchedComponents, displayMatchedComponents, unmatchedLines, displayedUnmatchedLines, totalMatchedCount };
}

/**
 * Score all known presets against the component match results.
 *
 * @param {object} resolver - Definition resolver
 * @param {Map} componentResults - Match results keyed by component ID
 * @param {number} totalInputLines - Total significant lines in the input .gitignore
 * @param {string} projectPath - Project root for signal detection
 * @param {object} [env] - Environment streams for debug logging
 * @returns {{ allPresets: object[], bestPreset: object|null }}
 */
function scoreAllPresets(resolver, componentResults, totalInputLines, projectPath, env) {
  const signalByPreset = new Map(
    detectProjectSignals(projectPath, env).map(signal => [signal.preset, signal])
  );

  const allPresets = [];
  try {
    const presetIds = resolver.listPresets();
    for (const presetId of presetIds) {
      try {
        const presetComponents = resolvePresetComponents(resolver, presetId);
        const ruleScore = scorePreset(presetComponents, componentResults, totalInputLines);
        const signal = signalByPreset.get(presetId);
        allPresets.push({
          id: presetId,
          ...ruleScore,
          score: ruleScore.score + (signal ? signal.strength : 0),
          componentCount: presetComponents.length,
          components: presetComponents,
          evidence: signal ? [signal.evidence] : []
        });
      } catch (err) {
        debugError(err, 'analyze.preset-base', env);
        // Skip presets with broken base chains
      }
    }
    allPresets.sort((a, b) => b.score - a.score);
  } catch (err) {
    debugError(err, 'analyze.presets-dir', env);
    // No presets directory
  }

  const bestPreset = allPresets.length > 0 ? allPresets[0] : null;
  return { allPresets, bestPreset };
}

/**
 * Run the analyze workflow (prints output to stdout).
 * @param {object} options
 * @param {string} options.gitignorePath - Path to the .gitignore file to analyze
 * @param {boolean} [options.suggestPreset] - Suggest best matching preset
 * @param {string} [options.distRoot] - Override dist root
 * @param {string} [options.userRoot] - User-level override directory
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
 * @param {string} [options.projectPath] - Project root directory for signal detection.
 *   When absent, defaults to the directory containing the .gitignore file. Pass this
 *   when the .gitignore is in a subdirectory and signal detection (package.json,
 *   build.gradle, etc.) should scan the actual project root instead.
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {string} [env.cwd] - Current working directory
 * @returns {{ totalLines: number, matchedComponents: object[], unmatchedLines: string[], bestPreset: object|null }}
 */
function runAnalyzeWorkflow(options, env) {
  const { stdout, stderr, cwd } = extractStreams(env);

  const analysis = analyzeGitignore({
    gitignorePath: path.resolve(cwd, options.gitignorePath),
    distRoot: options.distRoot || process.env.IGNOREKIT_DIST_ROOT || DIST_ROOT,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectPath: options.projectPath
  }, { stdout, stderr, cwd });

  // Header
  stdout.write(`Analyzing: ${path.basename(options.gitignorePath)} (${analysis.totalLines} significant lines)\n\n`);

  // Print matched components
  const displayMatchedComponents = analysis.displayMatchedComponents;
  const displayedUnmatchedLines = analysis.displayedUnmatchedLines;
  const coveragePercent = analysis.totalLines > 0
    ? Math.round((displayMatchedComponents.reduce((sum, c) => sum + c.matched.length, 0) / analysis.totalLines) * 100)
    : 0;

  stdout.write(`Matched components (${coveragePercent}% coverage):\n`);
  stdout.write(formatMatchedComponentsTable(displayMatchedComponents, { showMissing: true }));
  stdout.write('\n');

  // Print unmatched lines
  stdout.write(`Unmatched lines (${displayedUnmatchedLines.length}):\n`);
  if (displayedUnmatchedLines.length === 0) {
    stdout.write('  (none — all lines are covered by matched components)\n');
  } else {
    for (const line of displayedUnmatchedLines) {
      stdout.write(`  ${line}\n`);
    }
  }
  stdout.write('\n');

  // Preset suggestion
  if (options.suggestPreset) {
    if (analysis.allPresets.length > 0) {
      stdout.write('Preset suggestions:\n');
      for (const ps of analysis.allPresets.slice(0, 3)) {
        const matchLabel = `${ps.fullCount} of ${ps.componentCount} preset components fully matched`;
        stdout.write(`  ${ps.id.padEnd(ID_PAD)} ${matchLabel} (score: ${ps.score})\n`);
        for (const evidence of ps.evidence) {
          stdout.write(`    ${evidence}\n`);
        }
      }
      stdout.write('\n');
      stdout.write(`Best preset match: ${analysis.bestPreset.id} (${analysis.bestPreset.fullCount} of ${analysis.bestPreset.componentCount} preset components fully matched)\n`);
      for (const evidence of analysis.bestPreset.evidence) {
        stdout.write(`  ${evidence}\n`);
      }
    } else {
      stdout.write('No presets available for suggestion.\n');
    }
    stdout.write('\n');
  } else {
    stdout.write('Use --suggest-preset to get preset recommendations.\n');
  }

  return {
    totalLines: analysis.totalLines,
    matchedComponents: displayMatchedComponents.map(c => ({ id: c.id, matched: c.matched.length, total: c.total, classification: c.classification })),
    unmatchedLines: displayedUnmatchedLines,
    bestPreset: analysis.bestPreset ? {
      id: analysis.bestPreset.id,
      score: analysis.bestPreset.score,
      fullCount: analysis.bestPreset.fullCount,
      componentCount: analysis.bestPreset.componentCount,
      evidence: analysis.bestPreset.evidence
    } : null
  };
}

/**
 * Attempt to analyze a .gitignore file, catching errors and degrading
 * gracefully. Centralizes the "try analyzeGitignore, catch errors, write
 * diagnostic to stderr, return null" pattern that was duplicated across
 * adopt, create, and the preset picker.
 *
 * When analysis fails (commonly a .gitignore past the 1 MiB size guard),
 * the caller can still proceed — they just miss the matched-component
 * preview and custom-rule carry-forward. The error is surfaced to stderr
 * and to IGNOREKIT_DEBUG so the user can diagnose the failure.
 *
 * @param {object} analyzeOptions - Options forwarded to analyzeGitignore
 * @param {string} analyzeOptions.gitignorePath - Path to the .gitignore file
 * @param {string} [analyzeOptions.distRoot] - Dist root for definitions
 * @param {string} [analyzeOptions.userRoot] - User-level override directory
 * @param {string} [analyzeOptions.workspaceRoot] - Workspace-level definition directory
 * @param {string} [analyzeOptions.projectPath] - Project root for signal detection
 * @param {string} [analyzeOptions.content] - Pre-read content (skips disk read)
 * @param {boolean} [analyzeOptions.keepRawLines] - Preserve original byte text
 * @param {object} env - Environment streams ({ stdout, stderr, cwd })
 * @param {string} errorContext - Label for debugError logging (e.g. 'adopt.analyze')
 * @param {string} [errorMessage] - Override the stderr message on failure.
 *   Defaults to "Could not analyze <basename>: <err.message>".
 * @param {object} [options] - Additional options
 * @param {boolean} [options.throwOnError=false] - When true, re-throws the error after
 *   logging instead of returning null. Use when the caller cannot proceed without
 *   analysis (e.g. component creation with --from where the user must switch to --rule).
 * @returns {object|null} The analysis result, or null on failure (when throwOnError is false)
 */
function tryAnalyzeGitignore(analyzeOptions, env, errorContext, errorMessage, options = {}) {
  const { stderr } = extractStreams(env);
  try {
    return analyzeGitignore(analyzeOptions, env);
  } catch (err) {
    const label = errorMessage || `Could not analyze ${path.basename(analyzeOptions.gitignorePath)}: ${err.message}`;
    stderr.write(`${label}\n`);
    debugError(err, errorContext, env);
    if (options.throwOnError) throw err;
    return null;
  }
}

module.exports = { runAnalyzeWorkflow, analyzeGitignore, matchComponent, classifyMatch, scorePreset, matchAllComponents, scoreAllPresets, tryAnalyzeGitignore };
