'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { parseSignificantLines } = require('../src/core/text');
const { createDefinitionResolver, resolvePresetComponents } = require('../src/definitions/resolver');

const ROOT = path.resolve(__dirname, '..');
const COMPONENTS_ROOT = path.join(ROOT, 'components');
const resolver = createDefinitionResolver({ distRoot: ROOT });

function readComponent(id) {
  return fs.readFileSync(path.join(COMPONENTS_ROOT, `${id}.gitignore`), 'utf8');
}

function componentRules(id) {
  return parseSignificantLines(readComponent(id));
}

test('shipped presets do not produce duplicate ignore rules', () => {
  for (const preset of resolver.listPresets()) {
    const seen = new Map();
    const duplicates = [];
    for (const component of resolvePresetComponents(resolver, preset)) {
      for (const rule of parseSignificantLines(resolver.readComponent(component))) {
        if (seen.has(rule)) {
          duplicates.push(`${rule} (${seen.get(rule)}, ${component})`);
        } else {
          seen.set(rule, component);
        }
      }
    }
    assert.deepEqual(duplicates, [], `${preset} repeats rules: ${duplicates.join(', ')}`);
  }
});

test('every shipped component has distinct effective rules', () => {
  for (const component of resolver.listComponents()) {
    const rules = componentRules(component);
    assert.ok(rules.length > 0, `${component} must not be empty`);
    assert.equal(new Set(rules).size, rules.length, `${component} contains duplicate rules`);
  }
});

test('environment secrets cover mode-specific files but retain shareable examples', () => {
  const rules = componentRules('local/env-secrets');
  assert.ok(rules.includes('.env.*'));
  assert.ok(rules.includes('!.env.example'));
  assert.ok(rules.includes('!.env.sample'));
});

test('frontend framework components ignore their standard generated output', () => {
  assert.ok(componentRules('framework/vite').includes('dist/'));
  assert.ok(componentRules('framework/angular').includes('dist/'));
});

test('editor components hide local workspace state from public repositories', () => {
  const jetbrains = componentRules('editor/jetbrains');
  assert.ok(jetbrains.includes('.idea/'));
  assert.equal(jetbrains.some(rule => rule.startsWith('!.idea/')), false);

  const vscode = componentRules('editor/vscode');
  assert.ok(vscode.includes('.vscode/'));
  assert.equal(vscode.some(rule => rule.startsWith('!.vscode/')), false);
});

test('scientific artifacts do not hide a generic dvc source directory', () => {
  const rules = componentRules('domain/scientific-artifacts');
  assert.equal(rules.includes('dvc/'), false);
});

test('language and build components cover their standard generated artifacts', () => {
  for (const rule of ['*.lib', '*.pdb', '*.dSYM/']) {
    assert.ok(componentRules('language/c-cpp').includes(rule), `missing C/C++ rule: ${rule}`);
  }
  for (const rule of ['Makefile', 'Testing/']) {
    assert.ok(componentRules('build/cmake').includes(rule), `missing CMake rule: ${rule}`);
  }
  assert.ok(componentRules('language/rust').includes('*.pdb'));
  for (const rule of ['.coverage', 'htmlcov/', '.tox/', 'env/']) {
    assert.ok(componentRules('package/pip').includes(rule), `missing Python tooling rule: ${rule}`);
  }
});

test('PHP and Ruby presets keep project reproducibility files visible', () => {
  assert.equal(componentRules('language/php').includes('composer.lock'), false);
  assert.equal(componentRules('language/ruby').includes('.ruby-version'), false);
});

test('platform components cover common cross-platform metadata', () => {
  const windows = componentRules('platform/windows');
  assert.ok(windows.includes('Thumbs.db:encryptable'));
  assert.ok(windows.includes('ehthumbs_vista.db'));
  assert.ok(windows.includes('[Dd]esktop.ini'));

  const macos = componentRules('platform/macos');
  assert.ok(macos.includes('.localized'));
  assert.ok(macos.includes('__MACOSX/'));
});

test('framework presets do not imply an E2E test runner', () => {
  for (const preset of ['vite', 'next']) {
    assert.equal(resolvePresetComponents(resolver, preset).includes('testing/browser-e2e'), false);
  }
});

test('AI tool components hide complete local tool directories', () => {
  assert.deepEqual(componentRules('local/ai-claude'), ['.claude/', 'CLAUDE.local.md']);
  assert.deepEqual(componentRules('local/ai-codex'), ['.codex/']);
  assert.deepEqual(componentRules('local/ai-gemini'), ['.gemini/']);
});
