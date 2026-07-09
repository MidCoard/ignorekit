'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('../core/json');
const { normalizeText } = require('../core/text');
const { listDefinitions } = require('../core/fs');
const { createDefinitionResolver } = require('../definitions/resolver');
const { DIST_ROOT } = require('../core/path');

/**
 * Parse significant (non-comment, non-blank) lines from gitignore content.
 * @param {string} content
 * @returns {string[]}
 */
function parseSignificantLines(content) {
  return normalizeText(content).split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

/**
 * Compute match result for a component against input lines.
 * @param {Set<string>} inputLines - Normalized significant lines from the input .gitignore
 * @param {string} componentContent - Raw content of the component
 * @returns {{ matched: string[], unmatched: string[], total: number, ratio: number }}
 */
function matchComponent(inputLines, componentContent) {
  const componentLines = parseSignificantLines(componentContent);
  const matched = [];
  const unmatched = [];
  for (const line of componentLines) {
    if (inputLines.has(line)) {
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
 * @param {string[]} presetComponents - Component IDs in the preset
 * @param {Map<string, object>} componentResults - Match results keyed by component ID
 * @returns {{ score: number, fullCount: number, partialCount: number, missCount: number }}
 */
function scorePreset(presetComponents, componentResults) {
  let fullCount = 0;
  let partialCount = 0;
  let missCount = 0;
  for (const id of presetComponents) {
    const result = componentResults.get(id);
    if (!result) { missCount++; continue; }
    const cls = classifyMatch(result.ratio);
    if (cls === 'full') fullCount++;
    else if (cls === 'partial') partialCount++;
    else missCount++;
  }
  // Weight: full match = 2, partial = 1, miss = 0
  const score = fullCount * 2 + partialCount;
  return { score, fullCount, partialCount, missCount };
}

/**
 * Core analysis logic — no side effects. Reusable by extract and adopt.
 * @param {object} options
 * @param {string} options.gitignorePath - Path to the .gitignore file
 * @param {string} options.distRoot - Dist root for definitions
 * @param {string} [options.userRoot] - User-level override directory
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
 * @returns {{ totalLines: number, matchedComponents: object[], unmatchedLines: string[], componentResults: Map, bestPreset: object|null, allPresets: object[] }}
 */
function analyzeGitignore(options) {
  const gitignorePath = path.resolve(options.gitignorePath);
  const rawContent = fs.readFileSync(gitignorePath, 'utf8');
  const inputLines = parseSignificantLines(rawContent);
  const inputSet = new Set(inputLines);
  const totalInputLines = inputLines.length;

  const distRoot = options.distRoot || DIST_ROOT;
  const resolver = createDefinitionResolver({
    distRoot,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: path.dirname(gitignorePath)
  });

  // Load all components and match
  const componentsDir = path.join(distRoot, 'components');
  const componentIds = listDefinitions(componentsDir, '.gitignore');
  const componentResults = new Map();

  for (const id of componentIds) {
    try {
      const content = resolver.readComponent(id);
      const result = matchComponent(inputSet, content);
      if (result.matched.length > 0) {
        componentResults.set(id, result);
      }
    } catch {
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

  // Compute matched lines coverage
  const allMatchedLines = new Set();
  for (const comp of matchedComponents) {
    for (const line of comp.matched) {
      allMatchedLines.add(line);
    }
  }

  // Compute unmatched lines
  const unmatchedLines = inputLines.filter(line => !allMatchedLines.has(line));

  // Preset scoring
  const allPresets = [];
  try {
    const presetsDir = path.join(distRoot, 'presets');
    const presetIds = listDefinitions(presetsDir, '.json');
    for (const presetId of presetIds) {
      try {
        const presetDef = resolver.readPreset(presetId);
        const presetComponents = Array.isArray(presetDef.components) ? presetDef.components : [];
        const score = scorePreset(presetComponents, componentResults);
        allPresets.push({ id: presetId, ...score, componentCount: presetComponents.length, components: presetComponents });
      } catch {
        // Skip
      }
    }
    allPresets.sort((a, b) => b.score - a.score);
  } catch {
    // No presets directory
  }

  const bestPreset = allPresets.length > 0 ? allPresets[0] : null;

  return {
    totalLines: totalInputLines,
    matchedComponents,
    unmatchedLines,
    componentResults,
    bestPreset,
    allPresets
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
    workspaceRoot: options.workspaceRoot
  });

  // Header
  stdout.write(`Analyzing: ${path.basename(options.gitignorePath)} (${analysis.totalLines} significant lines)\n\n`);

  // Print matched components
  const coveragePercent = analysis.totalLines > 0
    ? Math.round((analysis.matchedComponents.reduce((sum, c) => sum + c.matched.length, 0) / analysis.totalLines) * 100)
    : 0;

  stdout.write(`Matched components (${coveragePercent}% coverage):\n`);
  for (const comp of analysis.matchedComponents) {
    const status = comp.classification === 'full' ? '✓ full match' : '✗ partial';
    const matchLabel = `${comp.matched.length}/${comp.total} rules matched`;
    const pad = 24;
    const idPadded = comp.id.padEnd(pad);
    stdout.write(`  ${idPadded} ${matchLabel.padEnd(22)} ${status}`);
    if (comp.classification === 'partial' && comp.unmatched.length > 0 && comp.unmatched.length <= 5) {
      stdout.write(` (missing: ${comp.unmatched.join(', ')})`);
    }
    stdout.write('\n');
  }
  stdout.write('\n');

  // Print unmatched lines
  stdout.write(`Unmatched lines (${analysis.unmatchedLines.length}):\n`);
  if (analysis.unmatchedLines.length === 0) {
    stdout.write('  (none — all lines are covered by matched components)\n');
  } else {
    for (const line of analysis.unmatchedLines) {
      stdout.write(`  ${line}\n`);
    }
  }
  stdout.write('\n');

  // Preset suggestion
  if (options.suggestPreset) {
    if (analysis.allPresets.length > 0) {
      stdout.write('Preset suggestions:\n');
      for (const ps of analysis.allPresets) {
        const matchLabel = `${ps.fullCount}/${ps.componentCount} components fully matched`;
        stdout.write(`  ${ps.id.padEnd(24)} ${matchLabel} (score: ${ps.score})\n`);
      }
      stdout.write('\n');
      stdout.write(`Best preset match: ${analysis.bestPreset.id} (${analysis.bestPreset.fullCount}/${analysis.bestPreset.componentCount} components fully matched)\n`);
    } else {
      stdout.write('No presets available for suggestion.\n');
    }
    stdout.write('\n');
  }

  return {
    totalLines: analysis.totalLines,
    matchedComponents: analysis.matchedComponents.map(c => ({ id: c.id, matched: c.matched.length, total: c.total, classification: c.classification })),
    unmatchedLines: analysis.unmatchedLines,
    bestPreset: analysis.bestPreset ? { id: analysis.bestPreset.id, score: analysis.bestPreset.score, fullCount: analysis.bestPreset.fullCount, componentCount: analysis.bestPreset.componentCount } : null
  };
}

module.exports = { runAnalyzeWorkflow, analyzeGitignore, parseSignificantLines, matchComponent, classifyMatch, scorePreset };
