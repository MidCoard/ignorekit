'use strict';

const https = require('https');
const { MAX_CONTENT_BYTES } = require('../core/constants');

/**
 * Patterns that resemble common secret filenames. A gitignore.io response
 * containing these is not necessarily malicious — many legitimate templates
 * include .env — but the user should be aware that the external content
 * references files that often hold secrets. The warning is informational, not
 * a block.
 */
const SECRET_LIKE_PATTERNS = [
  /\.env\b/i,
  /\.pem\b/i,
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
  const lines = content.split('\n');
  const found = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    for (const pattern of SECRET_LIKE_PATTERNS) {
      if (pattern.test(trimmed)) {
        found.push(trimmed);
        break;
      }
    }
  }
  return found;
}

function fetchGitignoreIoTemplates(templates) {
  const encoded = templates.map(encodeURIComponent).join(',');
  // The gitignore.io API endpoint is a fixed public service — hardcoding the
  // URL is acceptable for a CLI tool. If a user needs to override it (e.g.
  // for a corporate mirror), the provider's fetchText option bypasses this
  // function entirely.
  const url = `https://www.toptal.com/developers/gitignore/api/${encoded}`;

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
  // The gitignore.io response is content from an external service. While the
  // API is well-known and generally trustworthy, a compromised or misconfigured
  // endpoint could inject arbitrary patterns into the generated .gitignore.
  // The size guard in fetchGitignoreIoTemplates bounds the raw response, and
  // the secret-pattern check below warns the user when the response contains
  // patterns matching common secret filenames — a signal that the content
  // deserves manual review before being committed to a repository.
  let text;
  if (options.fetchText) {
    text = await options.fetchText(provider.templates);
  } else {
    text = await fetchGitignoreIoTemplates(provider.templates);
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

module.exports = { buildGitignoreIoProviderText, fetchGitignoreIoTemplates };
