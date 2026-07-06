'use strict';

const { buildLocalProviderText } = require('./local');
const { buildGitignoreIoProviderText } = require('./gitignore-io');

async function buildProviderText(provider, options = {}) {
  if (!provider || provider.name === 'local') {
    return buildLocalProviderText(provider, options);
  }
  if (provider.name === 'gitignore.io') {
    return buildGitignoreIoProviderText(provider, options);
  }
  throw new Error(`Unknown provider: ${provider.name}`);
}

module.exports = { buildProviderText };
