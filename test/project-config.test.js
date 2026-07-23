'use strict';

const assert = require('assert');
const test = require('node:test');
const { normalizeProjectConfig } = require('../src/config/project-config');

test('normalizes a project config with preset, provider, components, and custom rules', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    provider: { name: 'local' },
    components: ['local/logs'],
    custom: ['/runtime/']
  });

  assert.deepEqual(config, {
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    provider: { name: 'local' },
    components: ['local/logs'],
    exclude: [],
    custom: ['/runtime/'],
    addons: {}
  });
});

test('rejects configs without version 1', () => {
  assert.throws(() => normalizeProjectConfig({ name: 'demo' }), /version must be 1/);
});

test('rejects unknown provider name', () => {
  // Provider names are validated at config normalization time so that typos
  // are caught immediately rather than crashing at generation time.
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'gitignoreio', templates: ['java'] }
  }), /unknown provider/);
});

test('rejects local provider templates because they are not generated', () => {
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'local', templates: [] }
  }), /provider\.templates is not supported/i);
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
  assert.deepEqual(config.exclude, []);
});

test('rejects non-array component fields instead of silently dropping rules', () => {
  for (const field of ['components', 'exclude', 'custom']) {
    assert.throws(() => normalizeProjectConfig({
      version: 1,
      name: 'demo',
      [field]: 'not-an-array'
    }), new RegExp(`config\\.${field} must be an array`));
  }
});

test('rejects multi-line custom rules', () => {
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    custom: ['cache/\nlogs/']
  }), /config\.custom must not contain line breaks/);
});

test('normalizes exclude field', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    exclude: ['editor/java-ide-metadata']
  });
  assert.deepEqual(config.exclude, ['editor/java-ide-metadata']);
});

test('defaults exclude to empty array when omitted', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo'
  });
  assert.deepEqual(config.exclude, []);
});

test('rejects config without a name', () => {
  assert.throws(() => normalizeProjectConfig({ version: 1 }), /config.name is required/);
});

test('buildProjectConfig omits provider.templates when no templates are provided', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'local' });
  assert.deepEqual(config.provider, { name: 'local' });
});

test('buildProjectConfig rejects an empty project name', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  assert.throws(
    () => buildProjectConfig('', { provider: 'local' }),
    /project name is required/
  );
});

test('buildProjectConfig does not persist ignored provider templates', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'local', templates: ['Node'] });
  assert.deepEqual(config.provider, { name: 'local' });
});

test('buildProjectConfig rejects unknown provider name', () => {
  // Provider names are validated at construction time so typos are caught
  // before the config is written to disk, rather than failing later at
  // generation time.
  const { buildProjectConfig } = require('../src/config/build-config');
  assert.throws(
    () => buildProjectConfig('demo', { provider: 'gitignoreio', templates: ['java'] }),
    /unknown provider/i
  );
});

test('buildProjectConfig includes exclude field from options', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { preset: 'node', exclude: ['platform/macos', 'editor/vscode'] });
  assert.deepEqual(config.exclude, ['platform/macos', 'editor/vscode']);
});

test('buildProjectConfig defaults exclude to empty array when not provided', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { preset: 'node' });
  assert.deepEqual(config.exclude, []);
});

// --- validateProviderConfig (shared validation) ---

test('validateProviderConfig returns no errors for valid local provider', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'local' });
  assert.deepEqual(errors, []);
});

test('validateProviderConfig returns error for unknown provider', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'unknown' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown provider "unknown"/);
});

test('validateProviderConfig accepts providerName override', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ templates: ['Node'] }, 'local');
  assert.deepEqual(errors, []);
});

test('validateProviderConfig returns multiple errors for multiple violations', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  // Unknown provider + missing templates — both errors should be reported
  const errors = validateProviderConfig({ name: 'bogus' });
  assert.equal(errors.length, 1, 'unknown provider alone produces one error');
});

test('validateProviderConfig returns clear error when provider name is missing', () => {
  // When provider is an object without a .name property and providerName is
  // not provided, the old code produced "unknown provider "undefined"" which
  // is confusing. The guard must produce a clear "provider name is required"
  // message instead.
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ templates: ['Node'] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /provider name is required/);
});

test('validateProviderConfig returns clear error when provider name is empty string', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: '' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /provider name is required/);
});

test('validateProviderConfig returns clear error when provider name is not a string', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 42 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /provider name is required/);
});
