'use strict';

/**
 * Maximum size (in bytes) for a single .gitignore or template response.
 * Real files are a few KiB; the guard bounds worst-case memory and rejects
 * obviously-broken inputs before they can exhaust the buffer.
 */
const MAX_CONTENT_BYTES = 1024 * 1024;

/**
 * Validate a provider configuration object. Returns an array of error strings
 * (empty if valid). Only the "local" provider is supported — gitignore.io has
 * been removed in favor of the composable component system.
 *
 * @param {object} provider - Provider config with at least { name }
 * @param {string} [providerName] - Override for provider.name
 * @returns {string[]}
 */
function validateProviderConfig(provider, providerName) {
  const name = providerName || (provider && provider.name);
  const errors = [];
  if (!name || typeof name !== 'string') {
    errors.push('provider name is required');
    return errors;
  }
  if (name !== 'local') {
    errors.push(`unknown provider "${name}" — only "local" is supported`);
  }
  return errors;
}

module.exports = { MAX_CONTENT_BYTES, validateProviderConfig };
