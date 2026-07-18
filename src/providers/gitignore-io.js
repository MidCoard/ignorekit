'use strict';

const https = require('https');
const { MAX_CONTENT_BYTES } = require('../core/constants');
const { parseSignificantLines } = require('../core/text');

/**
 * Default gitignore.io API base URL. Used when IGNOREKIT_GITIGNORE_IO_URL is
 * not set. Extracted as a named constant so that fetchGitignoreIoTemplates and
 * validateGitignoreIoUrl share the same value — a mismatch between the two
 * would allow the validator to accept a different default than the fetcher
 * actually uses.
 */
const DEFAULT_GITIGNORE_IO_URL = 'https://www.toptal.com/developers/gitignore';

/**
 * Patterns that resemble common secret filenames. A gitignore.io response
 * containing these is not necessarily malicious — many legitimate templates
 * include .env — but the user should be aware that the external content
 * references files that often hold secrets. The warning is informational, not
 * a block.
 */
const SECRET_LIKE_PATTERNS = [
  // Leading whitespace is allowed because parseSignificantLines returns the
  // untrimmed original line — a gitignore entry like "  .env" is a valid rule
  // that Git interprets the same as ".env" (Git ignores leading unescaped
  // whitespace in patterns).
  /^\s*\.env($|\.)/i,
  /\.pem\b/i,
  // Intentionally broad: matches secret.key, id_rsa_key, keyring, etc.
  // False positives are acceptable — the warning is informational, not a
  // block. A narrower pattern like /\.secret\.key\b/ would miss real secret
  // files that lack the "secret" prefix (e.g. deploy.key, signing.key).
  /\.key\b/i,
  /\.p12\b/i,
  /\.pfx\b/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.htpasswd\b/i
];

/**
 * Check response content for patterns matching known secret filenames.
 * Returns an array of matched pattern descriptions (empty if none found).
 * @param {string} content
 * @returns {string[]}
 */
function detectSecretLikePatterns(content) {
  const found = [];
  for (const line of parseSignificantLines(content)) {
    for (const pattern of SECRET_LIKE_PATTERNS) {
      if (pattern.test(line)) {
        found.push(line);
        break;
      }
    }
  }
  return found;
}

/**
 * Check response content for gitignore negation patterns (lines starting
 * with !). A compromised or misconfigured gitignore.io endpoint could inject
 * negation patterns that re-include files the user intended to ignore (e.g.
 * `!secret.key` to un-ignore a secret file). This is a higher-severity
 * integrity risk than secret-like patterns because negation actively changes
 * the semantics of the user's existing .gitignore rules.
 * @param {string} content
 * @returns {string[]}
 */
function detectNegationPatterns(content) {
  const found = [];
  for (const line of parseSignificantLines(content)) {
    // Leading whitespace is insignificant in gitignore syntax — Git ignores
    // unescaped leading whitespace in patterns, so "  !keep-this" is a valid
    // negation. parseSignificantLines returns the untrimmed original line, so
    // trimStart() is needed to detect the '!' after whitespace, matching the
    // same approach used by SECRET_LIKE_PATTERNS (/^\s*\.env/).
    if (line.trimStart().startsWith('!')) {
      found.push(line);
    }
  }
  return found;
}

/**
 * Validate a gitignore.io base URL. Returns null if the URL is valid (or is
 * the default — the default public URL is always trusted), or an Error
 * describing the problem. Extracted from fetchGitignoreIoTemplates so it can
 * be tested independently without mocking https.get.
 *
 * The function validates the baseUrl parameter, NOT process.env. The caller
 * is responsible for resolving the env var and passing the result. This
 * avoids a TOCTOU race where the env var changes between the caller's read
 * and the validation call, and ensures that library consumers who call
 * validateGitignoreIoUrl directly get validation of the URL they passed,
 * not whatever the env var currently holds.
 *
 * @param {string} baseUrl - The raw URL value (from the env var or default)
 * @returns {Error|null}
 */
function validateGitignoreIoUrl(baseUrl) {
  if (!baseUrl || baseUrl === DEFAULT_GITIGNORE_IO_URL) return null;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_) {
    // When the URL is malformed, new URL() cannot parse it, so structural
    // redaction is not possible. A regex like /^[^@]*@/ only redacts up to
    // the first @ sign, which is insufficient for URLs like
    // prefix@user:pass@host/path (the second credential-bearing @ is left
    // exposed). Since the URL structure is unreliable anyway, redact the
    // entire string to avoid any credential leakage.
    return new Error(
      'IGNOREKIT_GITIGNORE_IO_URL is not a valid URL — the value has been redacted to prevent credential leakage. ' +
      'Include the scheme and host, e.g. "https://gitignore.example.com/api".'
    );
  }
  if (parsed.protocol !== 'https:') {
    return new Error(
      'IGNOREKIT_GITIGNORE_IO_URL must use https, not http. ' +
      'HTTP transmits templates and credentials in cleartext.'
    );
  }
  if (parsed.username || parsed.password) {
    return new Error(
      'IGNOREKIT_GITIGNORE_IO_URL contains embedded credentials — remove userinfo from the URL. ' +
      'Credentials in URLs are visible in process listings, logs, and error messages. ' +
      'Use environment variables or a credentials store instead.'
    );
  }
  return null;
}

/**
 * Fetch gitignore template text from the gitignore.io API (or a configured
 * mirror). Callers must validate the baseUrl before calling — this function
 * does not re-validate so that buildGitignoreIoProviderText can validate once
 * and avoid a redundant second check in the common case.
 *
 * @param {string[]} templates - Template names to fetch (e.g. ['java', 'gradle'])
 * @param {string} [baseUrl=DEFAULT_GITIGNORE_IO_URL] - The API base URL,
 *   resolved by the caller from process.env or the default. Passed explicitly
 *   to avoid a TOCTOU race where the env var changes between the caller's
 *   validation and this function's read.
 */
function fetchGitignoreIoTemplates(templates, baseUrl = DEFAULT_GITIGNORE_IO_URL) {
  const encoded = templates.map(encodeURIComponent).join(',');
  // The gitignore.io API endpoint defaults to the public service. Override
  // with IGNOREKIT_GITIGNORE_IO_URL for corporate mirrors or testing. The
  // env var must include the scheme and host but NOT the /api/ path suffix —
  // the templates are appended automatically. For example, setting it to
  // "https://mirror.internal/gitignore" produces the URL
  // "https://mirror.internal/gitignore/api/java,gradle".
  const url = `${baseUrl}/api/${encoded}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    function safeResolve(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }
    function safeReject(err) {
      if (settled) return;
      settled = true;
      reject(err);
    }
    const req = https.get(url, { timeout: 10000 }, (response) => {
      // Reject early based on Content-Length when the server advertises it,
      // before allocating any body buffer. This avoids paying for the first
      // oversized chunk before discovering the body is too large.
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTENT_BYTES) {
        req.destroy(new Error(`gitignore.io response too large (${declaredLength} bytes > ${MAX_CONTENT_BYTES})`));
        return;
      }
      let body = '';
      let bodyBytes = 0;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        bodyBytes += Buffer.byteLength(chunk, 'utf8');
        if (bodyBytes > MAX_CONTENT_BYTES) {
          req.destroy(new Error(`gitignore.io response exceeded ${MAX_CONTENT_BYTES} bytes`));
          return;
        }
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          safeReject(new Error(`gitignore.io returned HTTP ${response.statusCode}`));
          return;
        }
        safeResolve(body);
      });
      // A response stream can error independently of the request (e.g. ECONNRESET
      // mid-body). Without this handler the promise would hang forever because
      // neither 'end' nor the request-level 'error' fires for a response stream
      // error.
      response.on('error', safeReject);
    });
    req.on('timeout', () => {
      req.destroy();
      safeReject(new Error('gitignore.io request timed out'));
    });
    req.on('error', safeReject);
  });
}

async function buildGitignoreIoProviderText(provider, options = {}) {
  // Validate the base URL before branching into fetch paths. Without this,
  // the fetchText (test-injection) path would bypass URL validation entirely,
  // allowing a test to inject fetchText with a URL containing credentials or
  // using http without triggering the security checks.
  const baseUrl = process.env.IGNOREKIT_GITIGNORE_IO_URL || DEFAULT_GITIGNORE_IO_URL;
  const validationError = validateGitignoreIoUrl(baseUrl);
  if (validationError) {
    throw validationError;
  }

  // The gitignore.io response is content from an external service. While the
  // API is well-known and generally trustworthy, a compromised or misconfigured
  // endpoint could inject arbitrary patterns into the generated .gitignore.
  // The size guard in fetchGitignoreIoTemplates bounds the raw response, and
  // the content checks below warn the user when the response contains patterns
  // that deserve manual review before being committed to a repository.
  let text;
  if (options.fetchText) {
    text = await options.fetchText(provider.templates);
  } else {
    text = await fetchGitignoreIoTemplates(provider.templates, baseUrl);
  }
  const negations = detectNegationPatterns(text);
  if (negations.length > 0 && options.stderr) {
    options.stderr.write(
      `[ignorekit] Warning: gitignore.io response contains ${negations.length} negation pattern(s) ` +
      `(${negations.slice(0, 3).join(', ')}${negations.length > 3 ? ', ...' : ''}). ` +
      `Negation patterns (lines starting with !) can re-include files that other rules ignore. ` +
      `Review the generated .gitignore carefully before committing.\n`
    );
  }
  const secretLike = detectSecretLikePatterns(text);
  if (secretLike.length > 0 && options.stderr) {
    options.stderr.write(
      `[ignorekit] Warning: gitignore.io response contains patterns matching ` +
      `common secret filenames (${secretLike.slice(0, 3).join(', ')}${secretLike.length > 3 ? ', ...' : ''}). ` +
      `Review the generated .gitignore before committing.\n`
    );
  }
  return text;
}

module.exports = { buildGitignoreIoProviderText, fetchGitignoreIoTemplates, detectNegationPatterns, detectSecretLikePatterns, validateGitignoreIoUrl, DEFAULT_GITIGNORE_IO_URL };
