'use strict';

const { validateProviderConfig } = require('../core/constants');

function buildProjectConfig(name, options) {
  const provider = { name: options.provider || 'local' };
  const validationErrors = validateProviderConfig(provider, provider.name);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors[0]);
  }
  // Include provider.templates when provided (forward-compatible field —
  // ignored by the local provider but preserved in the config so the
  // field isn't lost if a user manually adds it).
  if (Array.isArray(options.templates) && options.templates.length > 0) {
    provider.templates = options.templates;
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
