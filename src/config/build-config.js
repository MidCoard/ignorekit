'use strict';

const { validateProviderConfig } = require('../core/constants');

function buildProjectConfig(name, options) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('project name is required');
  }
  const provider = { name: options.provider || 'local' };
  const validationErrors = validateProviderConfig(provider, provider.name);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors[0]);
  }
  return {
    version: 1,
    name,
    preset: options.preset,
    provider,
    components: options.components || [],
    exclude: options.exclude || [],
    custom: [],
    addons: {}
  };
}

module.exports = { buildProjectConfig };
