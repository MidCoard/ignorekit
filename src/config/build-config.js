'use strict';

const { validateProviderConfig } = require('../core/constants');

function buildProjectConfig(name, options) {
  const provider = { name: options.provider || 'local' };
  const validationErrors = validateProviderConfig(
    { name: provider.name, templates: options.templates },
    provider.name
  );
  if (validationErrors.length > 0) {
    // The first validation error is thrown with a CLI-oriented message that
    // mentions the --template flag, since buildProjectConfig is called from
    // the CLI path. Subsequent errors are suppressed to avoid overwhelming
    // the user — they'll see the next one after fixing the first.
    const first = validationErrors[0];
    if (/requires non-empty templates/.test(first)) {
      throw new Error(`Non-local provider "${provider.name}" requires at least one --template. Pass --template <name> (repeatable) with --provider ${provider.name}.`);
    }
    if (/must contain only strings/.test(first)) {
      throw new Error(`Non-local provider "${provider.name}" templates must contain only strings. Pass --template <name> (repeatable) with string values.`);
    }
    throw new Error(first);
  }
  // Set templates on the provider when the caller provided a non-empty array.
  // validateProviderConfig already ensures that non-local providers have
  // non-empty templates, so there is no need for a separate
  // PROVIDERS_REQUIRING_TEMPLATES check here — that would be a redundant
  // source of truth that must be kept in sync when new providers are added.
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
