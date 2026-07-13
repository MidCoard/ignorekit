'use strict';

const https = require('https');

// Cap gitignore.io responses at 1 MiB. Real template sets are a few KiB; the
// guard bounds worst-case memory and rejects obviously-broken servers before
// they can stream a gigabyte of garbage.
const MAX_BYTES = 1024 * 1024;

function fetchGitignoreIoTemplates(templates) {
  const encoded = templates.map(encodeURIComponent).join(',');
  const url = `https://www.toptal.com/developers/gitignore/api/${encoded}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (response) => {
      // Reject early based on Content-Length when the server advertises it,
      // before allocating any body buffer. This avoids paying for the first
      // oversized chunk before discovering the body is too large.
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
        req.destroy(new Error(`gitignore.io response too large (${declaredLength} bytes > ${MAX_BYTES})`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length + chunk.length > MAX_BYTES) {
          req.destroy(new Error(`gitignore.io response exceeded ${MAX_BYTES} bytes`));
          return;
        }
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`gitignore.io returned HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('gitignore.io request timed out'));
    });
    req.on('error', reject);
  });
}

async function buildGitignoreIoProviderText(provider, options = {}) {
  if (options.fetchText) {
    return options.fetchText(provider.templates);
  }
  return fetchGitignoreIoTemplates(provider.templates);
}

module.exports = { buildGitignoreIoProviderText, fetchGitignoreIoTemplates, MAX_BYTES };
