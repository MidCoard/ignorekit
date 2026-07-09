'use strict';

function buildProjectConfig(name, options) {
  const provider = { name: options.provider || 'local' };
  if (provider.name !== 'local' && Array.isArray(options.templates) && options.templates.length > 0) {
    provider.templates = options.templates;
  }
  return {
    version: 1,
    name,
    preset: options.preset,
    provider,
    components: options.components || [],
    custom: [],
    addons: {}
  };
}

module.exports = { buildProjectConfig };
