'use strict';

function normalizeStringArray(value, field) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`config.${field} must be an array`);
  }
  if (value.some(entry => typeof entry !== 'string')) {
    throw new Error(`config.${field} must contain only strings`);
  }
  return value;
}

function normalizeProjectConfig(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('config must be an object');
  }
  if (input.version !== 1) {
    throw new Error('config.version must be 1');
  }
  if (!input.name || typeof input.name !== 'string') {
    throw new Error('config.name is required');
  }
  if (input.preset !== undefined && typeof input.preset !== 'string') {
    throw new Error('config.preset must be a string');
  }

  const provider = input.provider || { name: 'local' };
  if (!provider.name || typeof provider.name !== 'string') {
    throw new Error('provider.name is required');
  }
  if (provider.name !== 'local' && !Array.isArray(provider.templates)) {
    throw new Error('provider.templates must be an array');
  }

  return {
    version: 1,
    name: input.name,
    preset: input.preset,
    provider,
    components: normalizeStringArray(input.components, 'components'),
    exclude: normalizeStringArray(input.exclude, 'exclude'),
    custom: normalizeStringArray(input.custom, 'custom'),
    addons: input.addons && typeof input.addons === 'object' ? input.addons : {}
  };
}

module.exports = { normalizeProjectConfig };
