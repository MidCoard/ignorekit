'use strict';

const fs = require('fs');
const path = require('path');
const { USER_ROOT, DIST_ROOT } = require('../core/path');
const { parseSignificantLines } = require('../core/text');
const { buildResolver } = require('../cli/resolver-factory');
const { analyzeGitignore } = require('../workflows/analyze');
const { formatMatchedComponentsHeader } = require('../workflows/_format');
const { debugError } = require('../core/debug');

function normalizeAnswer(value) {
  return String(value || '').trim();
}

/**
 * Parse a selection string (numbers, ranges, 'all') into selected items.
 * Returns null on invalid input so callers can re-prompt instead of crashing.
 * @param {string[]} items - Available items to select from
 * @param {string} answer - User's selection input
 * @param {string[]} [defaultItems=[]] - Items to return on empty input
 * @returns {string[]|null} Selected items, or null if input is invalid
 */
function selectItems(items, answer, defaultItems = []) {
  const input = normalizeAnswer(answer).toLowerCase();
  if (input === '') return [...defaultItems];
  if (input === 'all') return [...items];

  const selected = new Set();
  for (const token of input.split(',')) {
    const [startText, endText] = token.trim().split('-', 2);
    const start = Number(startText);
    const end = endText ? Number(endText) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > items.length) {
      return null;
    }
    for (let index = start; index <= end; index += 1) selected.add(index - 1);
  }
  return [...selected].sort((a, b) => a - b).map(index => items[index]);
}

function writeIndexedList(stdout, heading, items) {
  stdout.write(`${heading}:\n`);
  for (let index = 0; index < items.length; index += 1) {
    stdout.write(`  ${index + 1}. ${items[index]}\n`);
  }
}

/**
 * Render a list of rules with [x]/[ ] markers and optional coverage annotations.
 * Returns the array of selected lines (in original order).
 */
function renderSelection(stdout, lines, selectedSet, coverageAnnotations) {
  stdout.write(`Rules (${lines.length}, ${selectedSet.size} selected):\n`);
  for (let i = 0; i < lines.length; i += 1) {
    const marker = selectedSet.has(i) ? '[x]' : '[ ]';
    const note = coverageAnnotations && coverageAnnotations[i] ? `  (${coverageAnnotations[i]})` : '';
    stdout.write(`  ${marker} ${i + 1}. ${lines[i]}${note}\n`);
  }
}

/**
 * Parse a toggle command into a set of indices (1-based) to toggle.
 * Accepts: "3" (single), "1-3" or "1-3,5" (range + singles), "all", "none".
 * Returns null on invalid input.
 */
function parseToggleCommand(input, total) {
  const v = normalizeAnswer(input).toLowerCase();
  if (v === '') return []; // empty = no toggles this round
  if (v === 'all') return Array.from({ length: total }, (_, i) => i);
  if (v === 'none') return [];
  const result = [];
  for (const token of v.split(',')) {
    const [startText, endText] = token.trim().split('-', 2);
    const start = Number(startText);
    const end = endText ? Number(endText) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > total) {
      return null;
    }
    for (let i = start; i <= end; i += 1) result.push(i - 1);
  }
  return result;
}

/**
 * Run the toggle UI. Shows rules with [x]/[ ] markers and lets the user
 * toggle individual rules or ranges until they confirm with `done` or Enter.
 *
 * @param {string[]} lines - All lines from the source
 * @param {Set<number>} initialSelected - Indices initially selected
 * @param {Object<string,string>} [coverageAnnotations] - Map from index → note (e.g. "covered by editor/jetbrains")
 * @param {object} env - { stdout, ask }
 * @returns {Promise<string[]>} Final selected lines in original order
 */
async function runToggleSelection(lines, initialSelected, coverageAnnotations, env) {
  const selected = new Set(initialSelected);
  while (true) {
    env.stdout.write('\n');
    renderSelection(env.stdout, lines, selected, coverageAnnotations);
    const answer = await env.ask('Toggle rules (e.g. 3, 1-3, all, none) [done]: ');
    const v = normalizeAnswer(answer).toLowerCase();
    if (v === '' || v === 'done' || v === 'd' || v === 'write' || v === 'ok') break;
    const toggles = parseToggleCommand(answer, lines.length);
    if (toggles === null) {
      env.stdout.write(`Invalid input. Enter numbers (1-${lines.length}), ranges (1-3), 'all', 'none', or 'done'.\n`);
      continue;
    }
    for (const i of toggles) {
      if (selected.has(i)) selected.delete(i);
      else selected.add(i);
    }
  }
  return lines.filter((_, i) => selected.has(i));
}

/**
 * Smart rule selection. Analyzes the source file against known components,
 * shows the rules with [x]/[ ] markers (covered rules pre-deselected), and
 * lets the user toggle individual rules before confirming.
 *
 * Returns null when analysis cannot run (e.g. a > 1 MiB .gitignore is rejected
 * by analyzeGitignore's size guard). The caller falls back to inline rule
 * entry in that case so a single oversized file can't break the entire
 * interactive `create component` flow.
 *
 * @param {object} state - { sourcePath, rules, outputRoot }
 * @param {object} env - { cwd, stdout, ask, distRoot, userRoot, workspaceRoot }
 * @returns {Promise<string[]|null>} Final rule lines, or null to signal fallback
 */
async function chooseRulesSmart(state, env) {
  const sourcePath = state.sourcePath;
  let lines;
  let rawContent;
  try {
    rawContent = fs.readFileSync(sourcePath, 'utf8');
    lines = parseSignificantLines(rawContent);
  } catch (err) {
    throw new Error(`Cannot read source file ${sourcePath}: ${err.message}`);
  }
  if (lines.length === 0) {
    env.stdout.write('Source file contains no rules.\n');
    return [];
  }

  // Run smart analysis to mark covered rules. Failure here (commonly a
  // .gitignore past analyzeGitignore's 1 MiB guard) shouldn't break the
  // interactive flow — the user can still enter rules inline. Surface the
  // error to stderr under IGNOREKIT_DEBUG and signal the caller to fall back.
  let analysis;
  try {
    analysis = analyzeGitignore({
      gitignorePath: sourcePath,
      distRoot: env.distRoot || DIST_ROOT,
      userRoot: env.userRoot,
      workspaceRoot: env.workspaceRoot,
      // Pass the already-read content so analyzeGitignore doesn't re-read the
      // file we just parsed above (avoids a redundant disk hit and keeps the
      // single read site consistent with what the user sees on stdout).
      content: rawContent
    });
  } catch (err) {
    const stderr = env.stderr || process.stderr;
    stderr.write(`Could not analyze ${path.basename(sourcePath)}: ${err.message}\n`);
    stderr.write(`Falling back to inline rule entry.\n`);
    debugError(err, 'choose-rules-smart.analyze');
    return null;
  }

  env.stdout.write(`\nAnalyzing ${path.basename(sourcePath)}...\n`);
  if (analysis.matchedComponents.length > 0) {
    env.stdout.write(formatMatchedComponentsHeader(analysis.matchedComponents));
  }

  // Build coverage annotations and pre-selection
  // A line is "covered" if ANY matched component contains it (full OR partial match).
  // For full matches the component fully explains the line.
  // For partial matches the line is one of the matched rules; the component just
  // has additional rules the user didn't include.
  const coveredByLine = new Map(); // line → { id, classification }
  for (const comp of analysis.matchedComponents) {
    for (const line of comp.matched) {
      if (!coveredByLine.has(line)) {
        coveredByLine.set(line, { id: comp.id, classification: comp.classification });
      }
    }
  }
  const annotations = {};
  const initialSelected = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const cov = coveredByLine.get(lines[i]);
    if (cov) {
      const marker = cov.classification === 'full' ? 'fully covered' : 'partially covered';
      annotations[i] = `${marker} by ${cov.id}`;
      // Pre-deselect covered rules — user can re-enable if they want
    } else {
      initialSelected.add(i);
    }
  }

  return runToggleSelection(lines, initialSelected, annotations, env);
}

async function promptComponentCreation(options, env) {
  const resolver = buildResolver({ options, projectDirHint: env.cwd });
  const categories = [...new Set(resolver.listComponents().map(id => id.split('/')[0]))].sort();
  writeIndexedList(env.stdout, 'Available categories', categories);

  // Default source path: ./gitignore if it exists in cwd
  const defaultSourcePath = fs.existsSync(path.join(env.cwd, '.gitignore'))
    ? path.join(env.cwd, '.gitignore')
    : '';
  const sourcePrompt = defaultSourcePath
    ? `Source .gitignore (optional) [${defaultSourcePath}]: `
    : 'Source .gitignore (optional): ';

  const state = {
    category: normalizeAnswer(await env.ask('Category (local): ')) || 'local',
    name: normalizeAnswer(await env.ask('Component name: ')),
    sourcePath: normalizeAnswer(await env.ask(sourcePrompt)) || defaultSourcePath,
    rules: [],
    // --user-root is a discovery layer for analysis only; the write destination
    // is --output-root, defaulting to the shared user definitions directory.
    outputRoot: options.outputRoot || USER_ROOT
  };
  if (state.sourcePath) state.sourcePath = path.resolve(env.cwd, state.sourcePath);

  // If there's a source file, use smart selection. Otherwise inline rules.
  if (state.sourcePath) {
    const smartRules = await chooseRulesSmart(state, {
      cwd: env.cwd, stdout: env.stdout, stderr: env.stderr, ask: env.ask,
      distRoot: options.distRoot, userRoot: options.userRoot, workspaceRoot: options.workspaceRoot
    });
    // chooseRulesSmart returns null when analysis failed (e.g. oversized
    // .gitignore). In that case drop to inline rule entry so the interactive
    // flow can still produce a component.
    if (smartRules === null) {
      state.rules = await promptInlineRules(env);
    } else {
      state.rules = smartRules;
    }
  } else {
    state.rules = await promptInlineRules(env);
  }

  return state;
}

/**
 * Inline rule entry — the user types rules one per line, blank line ends.
 * Used both when the user provides no source file and when chooseRulesSmart
 * falls back after a failed analysis.
 */
async function promptInlineRules(env) {
  const rules = [];
  env.stdout.write('Enter rules one per line. Submit a blank line when finished.\n');
  while (true) {
    const rule = await env.ask('Rule: ');
    if (!String(rule || '').trim()) break;
    rules.push(String(rule));
  }
  return rules;
}

async function promptPresetCreation(options, env) {
  const resolver = buildResolver({ options, projectDirHint: env.cwd });
  const presetIds = resolver.listPresets();
  const componentIds = resolver.listComponents();
  const state = {
    name: normalizeAnswer(await env.ask('Preset name: ')),
    base: undefined,
    components: [],
    // --user-root is a discovery layer for analysis only; the write destination
    // is --output-root, defaulting to the shared user definitions directory.
    outputRoot: options.outputRoot || USER_ROOT
  };

  async function chooseBase() {
    env.stdout.write('Base preset:\n  0. no base\n');
    for (let index = 0; index < presetIds.length; index += 1) {
      env.stdout.write(`  ${index + 1}. ${presetIds[index]}\n`);
    }
    while (true) {
      const answer = normalizeAnswer(await env.ask('Base preset (0): ')) || '0';
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 0 && index <= presetIds.length) {
        return index === 0 ? undefined : presetIds[index - 1];
      }
      env.stdout.write(`Invalid selection. Enter a number 0-${presetIds.length}.\n`);
    }
  }

  async function chooseComponents() {
    writeIndexedList(env.stdout, 'Available components', componentIds);
    while (true) {
      const answer = await env.ask('Components to include (numbers, ranges, all; default: none): ');
      const result = selectItems(componentIds, answer, []);
      if (result !== null) return result;
      env.stdout.write(`Invalid selection. Enter numbers (1-${componentIds.length}), ranges (1-3), 'all', or press Enter for none.\n`);
    }
  }

  state.base = await chooseBase();
  state.components = await chooseComponents();

  return state;
}

module.exports = { promptComponentCreation, promptPresetCreation, selectItems, parseToggleCommand, runToggleSelection };