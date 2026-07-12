'use strict';

const fs = require('fs');
const path = require('path');
const { USER_ROOT, DIST_ROOT } = require('../core/path');
const { parseSignificantLines } = require('../core/text');
const { createDefinitionResolver } = require('../definitions/resolver');

function normalizeAnswer(value) {
  return String(value || '').trim();
}

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
      throw new Error(`Invalid selection: ${answer}`);
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

async function chooseRules(state, env) {
  if (state.sourcePath) {
    const lines = parseSignificantLines(fs.readFileSync(state.sourcePath, 'utf8'));
    writeIndexedList(env.stdout, 'Rules found in source', lines);
    const answer = await env.ask('Rules to include (numbers, ranges, all; default: all): ');
    return selectItems(lines, answer, lines);
  }

  const rules = [];
  env.stdout.write('Enter rules one per line. Submit a blank line when finished.\n');
  while (true) {
    const rule = await env.ask('Rule: ');
    if (!String(rule || '').trim()) return rules;
    rules.push(String(rule));
  }
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
  state.rules = await chooseRules(state, env);
  state.outputRoot = await chooseOutputRoot(state, env);

  while (true) {
    const outputPath = path.join(state.outputRoot, 'components', state.category, `${state.name}.gitignore`);
    env.stdout.write(`\nComponent: ${state.category}/${state.name}\nRules: ${state.rules.length}\nOutput: ${outputPath}\n`);
    const action = normalizeAnswer(await env.ask('Review [write/name/category/rules/output/cancel] (write): ')).toLowerCase() || 'write';
    if (action === 'write') return state;
    if (action === 'cancel') return null;
    if (action === 'name') state.name = normalizeAnswer(await env.ask('Component name: '));
    else if (action === 'category') state.category = normalizeAnswer(await env.ask('Category: '));
    else if (action === 'rules') state.rules = await chooseRules(state, env);
    else if (action === 'output') state.outputRoot = await chooseOutputRoot(state, env);
    else throw new Error(`Unknown review action: ${action}`);
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
    const answer = normalizeAnswer(await env.ask('Base preset (0): ')) || '0';
    const index = Number(answer);
    if (!Number.isInteger(index) || index < 0 || index > presetIds.length) throw new Error(`Invalid preset selection: ${answer}`);
    return index === 0 ? undefined : presetIds[index - 1];
  }

  async function chooseComponents() {
    writeIndexedList(env.stdout, 'Available components', componentIds);
    return selectItems(componentIds, await env.ask('Components to include (numbers, ranges, all; default: none): '), []);
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
    else throw new Error(`Unknown review action: ${action}`);
  }
}

module.exports = { promptComponentCreation, promptPresetCreation, selectItems };
