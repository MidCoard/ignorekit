'use strict';

const assert = require('assert');
const test = require('node:test');
const { normalizeProjectConfig } = require('../src/config/project-config');

test('normalizes a project config with preset, provider, components, and custom rules', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    provider: { name: 'gitignore.io', templates: ['java', 'gradle'] },
    components: ['local/logs'],
    custom: ['/runtime/']
  });

  assert.deepEqual(config, {
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    provider: { name: 'gitignore.io', templates: ['java', 'gradle'] },
    components: ['local/logs'],
    custom: ['/runtime/'],
    addons: {}
  });
});

test('rejects configs without version 1', () => {
  assert.throws(() => normalizeProjectConfig({ name: 'demo' }), /version must be 1/);
});

test('rejects provider templates that are not arrays', () => {
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'gitignore.io', templates: 'java' }
  }), /provider.templates must be an array/);
});

test('defaults provider to local when omitted', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    preset: 'java-gradle'
  });
  assert.deepEqual(config.provider, { name: 'local' });
});

test('defaults components and custom to empty arrays', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo'
  });
  assert.deepEqual(config.components, []);
  assert.deepEqual(config.custom, []);
});

test('rejects config without a name', () => {
  assert.throws(() => normalizeProjectConfig({ version: 1 }), /config.name is required/);
});
