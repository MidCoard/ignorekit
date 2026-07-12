'use strict';

const fs = require('fs');
const path = require('path');
const { USER_ROOT, DIST_ROOT } = require('../core/path');
const { parseSignificantLines } = require('../core/text');
const { createDefinitionResolver } = require('../definitions/resolver');
const { analyzeGitignore } = require('../workflows/analyze');

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

async function chooseOutputRoot(state, env) {
  const choice = normalizeAnswer(await env.ask('Output scope [user/project/workspace/custom] (user): ')).toLowerCase() || 'user';
  if (choice === 'user') return USER_ROOT;
  if (choice === 'project') return path.join(env.cwd, '.ignorekit');
  if (choice === 'workspace' || choice === 'custom') {
    const root = normalizeAnswer(await env.ask('Output directory: '));
    if (!root) throw new Error('Output directory is required');
    return path.resolve(env.cwd, root);
  }
  throw new Error(`Unknown output scope: ${choice}`);
}

/**
 * Smart rule selection. Analyzes the source file against known components,
 * shows the rules with [x]/[ ] markers (covered rules pre-deselected), and
 * lets the user toggle individual rules before confirming.
 *
 * @param {object} state - { sourcePath, rules, outputRoot }
 * @param {object} env - { cwd, stdout, ask, distRoot, userRoot, workspaceRoot }
 * @returns {Promise<string[]>} Final rule lines
 */
async function chooseRulesSmart(state, env) {
  const sourcePath = state.sourcePath;
  let lines;
  try {
    lines = parseSignificantLines(fs.readFileSync(sourcePath, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read source file ${sourcePath}: ${err.message}`);
  }
  if (lines.length === 0) {
    env.stdout.write('Source file contains no rules.\n');
    return [];
  }

  // Run smart analysis to mark covered rules
  const analysis = analyzeGitignore({
    gitignorePath: sourcePath,
    distRoot: env.distRoot || DIST_ROOT,
    userRoot: env.userRoot,
    workspaceRoot: env.workspaceRoot
  });

  env.stdout.write(`\nAnalyzing ${path.basename(sourcePath)}...\n`);
  if (analysis.matchedComponents.length > 0) {
    env.stdout.write(`Already covered by ${analysis.matchedComponents.length} known component(s):\n`);
    for (const comp of analysis.matchedComponents) {
      const status = comp.classification === 'full' ? '✓ full' : '✗ partial';
      env.stdout.write(`  ${comp.id.padEnd(24)} ${comp.matched.length}/${comp.total} rules ${status}\n`);
    }
    env.stdout.write('\n');
  }

  // Build coverage annotations and pre-selection
  // For each line, determine which (if any) known component covers it.
  // Covered lines are pre-deselected (unless they are partial).
  const coveredByLine = new Map(); // normalized line → component id
  for (const comp of analysis.matchedComponents) {
    if (comp.classification === 'full') {
      for (const line of comp.matched) {
        coveredByLine.set(line, comp.id);
      }
    }
  }
  const annotations = {};
  const initialSelected = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const cov = coveredByLine.get(lines[i]);
    if (cov) {
      annotations[i] = `covered by ${cov}`;
      // Pre-deselect fully covered rules
    } else {
      initialSelected.add(i);
    }
  }

  return runToggleSelection(lines, initialSelected, annotations, env);
}

async function promptComponentCreation(options, env) {
  const resolver = createDefinitionResolver({
    distRoot: options.distRoot || DIST_ROOT,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: path.join(env.cwd, '.ignorekit')
  });
  const categories = [...new Set(resolver.listComponents().map(id => id.split('/')[0]))].sort();
  writeIndexedList(env.stdout, 'Available categories', categories);

  const state = {
    category: normalizeAnswer(await env.ask('Category (local): ')) || 'local',
    name: normalizeAnswer(await env.ask('Component name: ')),
    sourcePath: normalizeAnswer(await env.ask('Source .gitignore (optional): ')),
    rules: [],
    outputRoot: null
  };
  if (state.sourcePath) state.sourcePath = path.resolve(env.cwd, state.sourcePath);

  // If there's a source file, use smart selection. Otherwise inline rules.
  if (state.sourcePath) {
    state.rules = await chooseRulesSmart(state, {
      cwd: env.cwd, stdout: env.stdout, ask: env.ask,
      distRoot: options.distRoot, userRoot: options.userRoot, workspaceRoot: options.workspaceRoot
    });
  } else {
    const rules = [];
    env.stdout.write('Enter rules one per line. Submit a blank line when finished.\n');
    while (true) {
      const rule = await env.ask('Rule: ');
      if (!String(rule || '').trim()) break;
      rules.push(String(rule));
    }
    state.rules = rules;
  }

  state.outputRoot = await chooseOutputRoot(state, env);

  while (true) {
    const outputPath = path.join(state.outputRoot, 'components', state.category, `${state.name}.gitignore`);
    env.stdout.write(`\nComponent: ${state.category}/${state.name}\nRules: ${state.rules.length}\nOutput: ${outputPath}\n`);
    const action = normalizeAnswer(await env.ask('Review [write/name/category/rules/output/cancel] (write): ')).toLowerCase() || 'write';
    if (action === 'write') return state;
    if (action === 'cancel') return null;
    if (action === 'name') state.name = normalizeAnswer(await env.ask('Component name: '));
    else if (action === 'category') state.category = normalizeAnswer(await env.ask('Category: '));
    else if (action === 'rules') {
      if (state.sourcePath) {
        state.rules = await chooseRulesSmart(state, {
          cwd: env.cwd, stdout: env.stdout, ask: env.ask,
          distRoot: options.distRoot, userRoot: options.userRoot, workspaceRoot: options.workspaceRoot
        });
      } else {
        const rules = [];
        env.stdout.write('Enter rules one per line. Submit a blank line when finished.\n');
        while (true) {
          const rule = await env.ask('Rule: ');
          if (!String(rule || '').trim()) break;
          rules.push(String(rule));
        }
        state.rules = rules;
      }
    }
    else if (action === 'output') state.outputRoot = await chooseOutputRoot(state, env);
    else {
      env.stdout.write(`Unknown review action: ${action}. Use: write, name, category, rules, output, or cancel.\n`);
    }
  }
}

async function promptPresetCreation(options, env) {
  const resolver = createDefinitionResolver({
    distRoot: options.distRoot || DIST_ROOT,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: path.join(env.cwd, '.ignorekit')
  });
  const presetIds = resolver.listPresets();
  const componentIds = resolver.listComponents();
  const state = {
    name: normalizeAnswer(await env.ask('Preset name: ')),
    base: undefined,
    components: [],
    outputRoot: null
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
  state.outputRoot = await chooseOutputRoot(state, env);

  while (true) {
    const outputPath = path.join(state.outputRoot, 'presets', `${state.name}.json`);
    env.stdout.write(`\nPreset: ${state.name}\nBase: ${state.base || 'none'}\nComponents: ${state.components.length}\nOutput: ${outputPath}\n`);
    const action = normalizeAnswer(await env.ask('Review [write/name/base/components/output/cancel] (write): ')).toLowerCase() || 'write';
    if (action === 'write') return state;
    if (action === 'cancel') return null;
    if (action === 'name') state.name = normalizeAnswer(await env.ask('Preset name: '));
    else if (action === 'base') state.base = await chooseBase();
    else if (action === 'components') state.components = await chooseComponents();
    else if (action === 'output') state.outputRoot = await chooseOutputRoot(state, env);
    else {
      env.stdout.write(`Unknown review action: ${action}. Use: write, name, base, components, output, or cancel.\n`);
    }
  }
}

module.exports = { promptComponentCreation, promptPresetCreation, selectItems, parseToggleCommand, runToggleSelection };