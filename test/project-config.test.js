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

test('buildProjectConfig includes provider.templates when provider is not local and templates are provided', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'gitignore.io', templates: ['Node', 'Python'] });
  assert.deepEqual(config.provider, { name: 'gitignore.io', templates: ['Node', 'Python'] });
});

test('buildProjectConfig omits provider.templates when provider is local', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'local', templates: ['Node'] });
  assert.deepEqual(config.provider, { name: 'local' });
});

test('buildProjectConfig omits provider.templates when templates array is empty', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'gitignore.io', templates: [] });
  assert.deepEqual(config.provider, { name: 'gitignore.io' });
});

test('fetchGitignoreIoTemplates rejects on timeout', async () => {
  const EventEmitter = require('events');
  const https = require('https');
  const origGet = https.get;

  https.get = function mockGet(url, options, callback) {
    const req = new EventEmitter();
    req.destroy = () => {};
    // Simulate timeout on next tick
    process.nextTick(() => req.emit('timeout'));
    return req;
  };

  try {
    const { fetchGitignoreIoTemplates } = require('../src/providers/gitignore-io');
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
    const fresh = require('../src/providers/gitignore-io');

    await assert.rejects(
      fresh.fetchGitignoreIoTemplates(['Node']),
      /timed out/
    );
  } finally {
    https.get = origGet;
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
  }
});
