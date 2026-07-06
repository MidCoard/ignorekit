'use strict';

function buildProjectConfig(name, options) {
  return {
    version: 1,
    name,
    preset: options.preset,
    provider: { name: options.provider || 'local' },
    components: options.components || [],
    custom: [],
    addons: {}
  };
}

module.exports = { buildProjectConfig };
