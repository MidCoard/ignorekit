'use strict';

const { buildLocalProviderText } = require('./local');
const { buildGitignoreIoProviderText } = require('./gitignore-io');
const { VALID_PROVIDERS } = require('../core/constants');

/**
 * Provider builder registry. Each key is a provider name; each value is the
 * async function that builds the provider's text contribution. Adding a new
 * provider requires an entry here AND in VALID_PROVIDERS (core/constants.js).
 *
 * The registry is checked against VALID_PROVIDERS at load time so a missing
 * entry is caught immediately rather than at runtime when a user actually
 * selects the provider.
 */
const PROVIDER_BUILDERS = {
  local: buildLocalProviderText,
  'gitignore.io': buildGitignoreIoProviderText
};

// Startup assertion: every VALID_PROVIDERS entry must have a builder, and
// every builder key must be in VALID_PROVIDERS. This catches the most common
// drift scenario — a provider added to one location but not the other —
// before any user-facing code runs.
{
  const missing = [...VALID_PROVIDERS].filter(name => !PROVIDER_BUILDERS[name]);
  if (missing.length > 0) {
    throw new Error(`Provider(s) in VALID_PROVIDERS without a builder: ${missing.join(', ')}`);
  }
  const extra = Object.keys(PROVIDER_BUILDERS).filter(name => !VALID_PROVIDERS.has(name));
  if (extra.length > 0) {
    throw new Error(`Provider builder(s) not in VALID_PROVIDERS: ${extra.join(', ')}`);
  }
}

async function buildProviderText(provider, options = {}) {
  if (!provider) {
    return buildLocalProviderText(provider, options);
  }
  const builder = PROVIDER_BUILDERS[provider.name];
  if (builder) {
    return builder(provider, options);
  }
  throw new Error(`Unknown provider: ${provider.name}`);
}

module.exports = { buildProviderText };
