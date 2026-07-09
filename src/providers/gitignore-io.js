'use strict';

const https = require('https');

function fetchGitignoreIoTemplates(templates) {
  const encoded = templates.map(encodeURIComponent).join(',');
  const url = `https://www.toptal.com/developers/gitignore/api/${encoded}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          req.destroy(new Error('gitignore.io response too large'));
        }
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

module.exports = { buildGitignoreIoProviderText, fetchGitignoreIoTemplates };
