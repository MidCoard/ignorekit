'use strict';

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
    components: Array.isArray(input.components) ? input.components : [],
    custom: Array.isArray(input.custom) ? input.custom : [],
    addons: input.addons && typeof input.addons === 'object' ? input.addons : {}
  };
}

module.exports = { normalizeProjectConfig };
