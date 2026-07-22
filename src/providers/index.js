'use strict';

const { buildLocalProviderText } = require('./local');

async function buildProviderText(provider, options = {}) {
  // Only the local provider is supported. The provider field is kept in
  // ignorekit.json for forward compatibility, but non-local providers
  // (e.g. gitignore.io) have been removed — the component system covers
  // the same use case without runtime network calls.
  return buildLocalProviderText(provider, options);
}

module.exports = { buildProviderText };
