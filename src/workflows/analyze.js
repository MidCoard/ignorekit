'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('../core/json');
const { parseSignificantLines, normalizePattern } = require('../core/text');
const { resolvePresetComponents } = require('../definitions/resolver');
const { buildResolver } = require('../core/resolver-factory');
const { DIST_ROOT } = require('../core/path');
const { detectProjectSignals } = require('../detection/project-signals');
const { formatMatchedComponentsTable } = require('./_format');
const { debugError } = require('../core/debug');
const { MAX_CONTENT_BYTES } = require('../core/constants');

/**
 * Compute match result for a component against input lines.
 * @param {Iterable<string>} inputLines - Normalized significant lines from the input .gitignore
 * @param {string} componentContent - Raw content of the component
 * @returns {{ matched: string[], unmatched: string[], total: number, ratio: number }}
 */
function matchComponent(inputLines, componentContent) {
  const componentLines = parseSignificantLines(componentContent);
  // Build a normalized lookup set from input lines
  const normalizedInput = new Set();
  for (const line of inputLines) {
    normalizedInput.add(normalizePattern(line));
  }
  const matched = [];
  const unmatched = [];
  for (const line of componentLines) {
    if (normalizedInput.has(normalizePattern(line))) {
      matched.push(line);
    } else {
      unmatched.push(line);
    }
  }
  const total = componentLines.length;
  const ratio = total > 0 ? matched.length / total : 0;
  return { matched, unmatched, total, ratio };
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

  const distRoot = options.distRoot || DIST_ROOT;
  const resolver = buildResolver({ options, projectDirHint: projectPath });
  const signalByPreset = new Map(
    detectProjectSignals(projectPath, env).map(signal => [signal.preset, signal])
  );

  // Load all components and match
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

  // Compute matched lines coverage (use normalized patterns for dedup)
  const allMatchedNormalized = new Set();
  for (const comp of matchedComponents) {
    for (const line of comp.matched) {
      allMatchedNormalized.add(normalizePattern(line));
    }
  }

  // Compute unmatched lines (using normalized comparison)
  const unmatchedLines = inputLines.filter(line => !allMatchedNormalized.has(normalizePattern(line)));

  // Unmatched lines relative to the *displayed* subset of matched components.
  // The display filter hides low-signal partials, so a line those hidden
  // components covered still needs to appear as unmatched to the user. Computed
  // here from inputLines so callers never re-read the source file.
  const displayedRules = new Set();
  for (const component of displayMatchedComponents) {
    for (const line of component.matched) displayedRules.add(normalizePattern(line));
  }
  const displayedUnmatchedLines = inputLines.filter(line => !displayedRules.has(normalizePattern(line)));

  // Coverage calculation (use matched count from components)
  const totalMatchedCount = matchedComponents.reduce((sum, c) => sum + c.matched.length, 0);

  // Preset scoring
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

  return {
    totalLines: totalInputLines,
    inputLines,
    matchedComponents,
    displayMatchedComponents,
    unmatchedLines,
    displayedUnmatchedLines,
    componentResults,
    bestPreset,
    allPresets,
    ...(originalLines ? { originalLines } : {})
  };
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
  const stdout = env.stdout || process.stdout;
  const cwd = env.cwd || process.cwd();

  const analysis = analyzeGitignore({
    gitignorePath: path.resolve(cwd, options.gitignorePath),
    distRoot: options.distRoot || DIST_ROOT,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectPath: options.projectPath
  }, { stderr: env.stderr });

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
        stdout.write(`  ${ps.id.padEnd(24)} ${matchLabel} (score: ${ps.score})\n`);
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

// Re-export normalizePattern and parseSignificantLines from core/text for
// backward compatibility. These utilities belong in core/text.js (the correct
// layer for pure text operations), not in a workflow module. No production
// code imports them from here anymore — only test files reference these
// re-exports. Import from core/text.js directly instead.
//
// @deprecated Import parseSignificantLines and normalizePattern from
// '../core/text' (or '../../core/text' from test files) instead of from
// this module. The re-exports will be removed in a future major version.
module.exports = { runAnalyzeWorkflow, analyzeGitignore, parseSignificantLines, normalizePattern, matchComponent, classifyMatch, scorePreset };
