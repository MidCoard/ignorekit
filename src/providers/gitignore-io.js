'use strict';

const https = require('https');

function fetchGitignoreIoTemplates(templates) {
  const encoded = templates.map(encodeURIComponent).join(',');
  const url = `https://www.toptal.com/developers/gitignore/api/${encoded}`;

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`gitignore.io returned HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    }).on('error', reject);
  });
}

async function buildGitignoreIoProviderText(provider, options = {}) {
  if (options.fetchText) {
    return options.fetchText(provider.templates);
  }
  return fetchGitignoreIoTemplates(provider.templates);
}

module.exports = { buildGitignoreIoProviderText, fetchGitignoreIoTemplates };
