'use strict';

/**
 * Maximum size (in bytes) for a single .gitignore or template response.
 * Real files are a few KiB; the guard bounds worst-case memory and rejects
 * obviously-broken inputs before they can exhaust the buffer.
 */
const MAX_CONTENT_BYTES = 1024 * 1024;

/**
 * Recognized provider names. Adding a new provider requires an entry here
 * AND a corresponding builder in PROVIDER_BUILDERS (providers/index.js).
 * A startup assertion in providers/index.js checks both directions, so a
 * mismatch is caught immediately rather than at runtime.
 * The set is shared with validate-situations.js so the script stays in
 * sync with production code.
 */
const VALID_PROVIDERS = new Set(['local', 'gitignore.io']);

/**
 * Provider names that require a templates array. Non-local providers
 * (e.g. gitignore.io) need template names to fetch content; the local
 * provider generates content from resolved components instead. Centralized
 * here so build-config.js and project-config.js share the same logic
 * rather than each hardcoding `provider.name !== 'local'`.
 */
const PROVIDERS_REQUIRING_TEMPLATES = new Set(['gitignore.io']);

/**
 * Validate a provider configuration object. Returns an array of error strings
 * (empty if valid). Centralizes the three checks that were previously
 * triplicated across build-config.js, project-config.js, and
 * validate-situations.js:
 *
 *  1. Provider name must be in VALID_PROVIDERS.
 *  2. Non-local providers must have a non-empty templates array.
 *  3. Template elements must all be strings.
 *
 * Call sites decide how to surface errors (throw vs. push to an array).
 * The `providerName` parameter allows the caller to supply the name separately
 * when the provider object might not have a `.name` property yet (e.g.
 * build-config.js constructs the provider object from CLI options).
 *
 * @param {object} provider - Provider config with at least { name }
 * @param {string} [providerName] - Override for provider.name (used when the
 *   caller has the name from a different source, e.g. CLI options)
 * @returns {string[]}
 */
function validateProviderConfig(provider, providerName) {
  const name = providerName || (provider && provider.name);
  const errors = [];
  // Guard: when the name is missing or not a string, the subsequent checks
  // would produce confusing messages like 'unknown provider "undefined"'.
  // Return early with a clear message so callers know exactly what's wrong.
  if (!name || typeof name !== 'string') {
    errors.push('provider name is required');
    return errors;
  }
  if (!VALID_PROVIDERS.has(name)) {
    errors.push(`unknown provider "${name}" — valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
  }
  if (PROVIDERS_REQUIRING_TEMPLATES.has(name)) {
    if (!Array.isArray(provider.templates) || provider.templates.length === 0) {
      errors.push(`provider "${name}" requires non-empty templates`);
    } else if (provider.templates.some(t => typeof t !== 'string')) {
      errors.push(`provider "${name}" templates must contain only strings`);
    }
  }
  return errors;
}

module.exports = { MAX_CONTENT_BYTES, VALID_PROVIDERS, validateProviderConfig };
