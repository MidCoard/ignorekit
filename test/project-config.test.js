'use strict';

const assert = require('assert');
const test = require('node:test');
const { normalizeProjectConfig } = require('../src/config/project-config');

test('normalizes a project config with preset, provider, components, and custom rules', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    provider: { name: 'gitignore.io', templates: ['java', 'gradle'] },
    components: ['local/logs'],
    custom: ['/runtime/']
  });

  assert.deepEqual(config, {
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    provider: { name: 'gitignore.io', templates: ['java', 'gradle'] },
    components: ['local/logs'],
    exclude: [],
    custom: ['/runtime/'],
    addons: {}
  });
});

test('rejects configs without version 1', () => {
  assert.throws(() => normalizeProjectConfig({ name: 'demo' }), /version must be 1/);
});

test('rejects provider templates that are not arrays', () => {
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'gitignore.io', templates: 'java' }
  }), /requires non-empty templates/);
});

test('rejects non-local provider with empty templates array', () => {
  // An empty templates array passes the Array.isArray check but produces a
  // broken gitignore.io API call (no templates to fetch). The provider has
  // nothing to contribute, so the config is invalid.
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'gitignore.io', templates: [] }
  }), /requires non-empty templates/);
});

test('rejects non-local provider with non-string template elements', () => {
  // Template names must be strings — a numeric or object element would be
  // silently coerced by encodeURIComponent, producing a wrong API URL.
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'gitignore.io', templates: ['java', 42] }
  }), /must contain only strings/);
});

test('rejects unknown provider name', () => {
  // Provider names are validated at config normalization time so that typos
  // (e.g. "gitignoreio" instead of "gitignore.io") are caught immediately
  // rather than crashing at generation time with a confusing "Unknown
  // provider" error from buildProviderText.
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'gitignoreio', templates: ['java'] }
  }), /unknown provider/);
});

test('accepts local provider with empty templates array', () => {
  // Local provider ignores templates entirely, so an empty array is harmless.
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'local', templates: [] }
  });
  assert.deepEqual(config.provider, { name: 'local', templates: [] });
});

test('defaults provider to local when omitted', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    preset: 'java-gradle'
  });
  assert.deepEqual(config.provider, { name: 'local' });
});

test('defaults components and custom to empty arrays', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo'
  });
  assert.deepEqual(config.components, []);
  assert.deepEqual(config.custom, []);
  assert.deepEqual(config.exclude, []);
});

test('rejects non-array component fields instead of silently dropping rules', () => {
  for (const field of ['components', 'exclude', 'custom']) {
    assert.throws(() => normalizeProjectConfig({
      version: 1,
      name: 'demo',
      [field]: 'not-an-array'
    }), new RegExp(`config\\.${field} must be an array`));
  }
});

test('normalizes exclude field', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    exclude: ['editor/java-ide-metadata']
  });
  assert.deepEqual(config.exclude, ['editor/java-ide-metadata']);
});

test('defaults exclude to empty array when omitted', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo'
  });
  assert.deepEqual(config.exclude, []);
});

test('rejects config without a name', () => {
  assert.throws(() => normalizeProjectConfig({ version: 1 }), /config.name is required/);
});

test('buildProjectConfig includes provider.templates when templates are provided', () => {
  // Templates are set on the provider whenever options.templates is a non-empty
  // array. validateProviderConfig ensures non-local providers have templates,
  // so there is no separate PROVIDERS_REQUIRING_TEMPLATES check — the
  // validation and the assignment are independent concerns.
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'gitignore.io', templates: ['Node', 'Python'] });
  assert.deepEqual(config.provider, { name: 'gitignore.io', templates: ['Node', 'Python'] });
});

test('buildProjectConfig omits provider.templates when no templates are provided', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'local' });
  assert.deepEqual(config.provider, { name: 'local' });
});

test('buildProjectConfig includes provider.templates for local provider when templates are provided', () => {
  // Local provider ignores templates at generation time, but the config
  // object still carries them when the caller provides a non-empty array.
  // This avoids a redundant PROVIDERS_REQUIRING_TEMPLATES check that would
  // need to be kept in sync when new providers are added.
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'local', templates: ['Node'] });
  assert.deepEqual(config.provider, { name: 'local', templates: ['Node'] });
});

test('buildProjectConfig rejects non-local provider without templates', () => {
  // A gitignore.io provider without templates produces a config that will
  // fail when normalizeProjectConfig is called later (it requires
  // provider.templates for non-local providers). The error must be caught
  // at construction time, not deferred to generation.
  const { buildProjectConfig } = require('../src/config/build-config');
  assert.throws(
    () => buildProjectConfig('demo', { provider: 'gitignore.io' }),
    /requires at least one --template/i
  );
});

test('buildProjectConfig rejects non-local provider with empty templates array', () => {
  // An empty templates array is semantically the same as no templates —
  // the provider has nothing to fetch. This must be rejected at construction
  // time rather than producing a config that silently generates no provider
  // content.
  const { buildProjectConfig } = require('../src/config/build-config');
  assert.throws(
    () => buildProjectConfig('demo', { provider: 'gitignore.io', templates: [] }),
    /requires at least one --template/i
  );
});

test('buildProjectConfig rejects non-string template elements for non-local provider', () => {
  // Template names must be strings — a numeric or object element would be
  // silently coerced by encodeURIComponent in the gitignore.io URL builder,
  // producing a wrong API call. buildProjectConfig must validate at
  // construction time, not defer to normalizeProjectConfig.
  const { buildProjectConfig } = require('../src/config/build-config');
  assert.throws(
    () => buildProjectConfig('demo', { provider: 'gitignore.io', templates: ['Node', 42] }),
    /must contain only strings/i
  );
});

test('buildProjectConfig rejects unknown provider name', () => {
  // Provider names are validated at construction time so typos (e.g.
  // "gitignoreio" instead of "gitignore.io") are caught before the config
  // is written to disk, rather than failing later at generation time.
  const { buildProjectConfig } = require('../src/config/build-config');
  assert.throws(
    () => buildProjectConfig('demo', { provider: 'gitignoreio', templates: ['java'] }),
    /unknown provider/i
  );
});

test('buildProjectConfig includes exclude field from options', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { preset: 'node', exclude: ['platform/macos', 'editor/vscode'] });
  assert.deepEqual(config.exclude, ['platform/macos', 'editor/vscode']);
});

test('buildProjectConfig defaults exclude to empty array when not provided', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { preset: 'node' });
  assert.deepEqual(config.exclude, []);
});

test('fetchGitignoreIoTemplates rejects on timeout', async () => {
  const EventEmitter = require('events');
  const https = require('https');
  const origGet = https.get;

  https.get = function mockGet(url, options, callback) {
    const req = new EventEmitter();
    req.destroy = () => {};
    // Simulate timeout on next tick
    process.nextTick(() => req.emit('timeout'));
    return req;
  };

  try {
    const { fetchGitignoreIoTemplates } = require('../src/providers/gitignore-io');
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
    const fresh = require('../src/providers/gitignore-io');

    await assert.rejects(
      fresh.fetchGitignoreIoTemplates(['Node']),
      /timed out/
    );
  } finally {
    https.get = origGet;
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
  }
});

// --- #8: Content-Length and per-chunk size guard ---

test('fetchGitignoreIoTemplates rejects oversized Content-Length before consuming the body', async () => {
  // The original guard only checked `body.length > MAX_CONTENT_BYTES` after each chunk
  // was concatenated, so a 2 MiB first chunk was already in memory by the
  // time the rejection happened. The fix inspects Content-Length up front and
  // rejects before any body buffer is allocated.
  const EventEmitter = require('events');
  const https = require('https');
  const origGet = https.get;

  https.get = function mockGet(url, options, callback) {
    const req = new EventEmitter();
    req.destroy = (err) => {
      req._destroyed = err;
      // Real http.ClientRequest.destroy(err) emits 'error' on the request so
      // upstream listeners (the rejection handler in fetchGitignoreIoTemplates)
      // can act on the destroy reason. The mock must do the same or the
      // promise stays pending and the test hangs.
      if (err) req.emit('error', err);
    };
    const response = new EventEmitter();
    response.headers = { 'content-length': String(2 * 1024 * 1024) };
    response.statusCode = 200;
    process.nextTick(() => callback(response));
    return req;
  };

  try {
    const { fetchGitignoreIoTemplates } = require('../src/providers/gitignore-io');
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
    const fresh = require('../src/providers/gitignore-io');

    await assert.rejects(
      fresh.fetchGitignoreIoTemplates(['Node']),
      /too large/
    );
  } finally {
    https.get = origGet;
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
  }
});

test('fetchGitignoreIoTemplates rejects when body+chunk exceeds MAX_CONTENT_BYTES', async () => {
  // Per-chunk guard: server does not advertise Content-Length, so we still
  // need to reject mid-stream when accumulated bytes cross the cap.
  const EventEmitter = require('events');
  const https = require('https');
  const origGet = https.get;

  https.get = function mockGet(url, options, callback) {
    const req = new EventEmitter();
    req.destroy = (err) => {
      req._destroyed = err;
      if (err) req.emit('error', err);
    };
    const response = new EventEmitter();
    response.headers = {}; // no Content-Length
    response.statusCode = 200;
    response.setEncoding = () => {};
    process.nextTick(() => {
      callback(response);
      // Emit a single oversized chunk — exceeds 1 MiB on its own.
      setImmediate(() => response.emit('data', 'x'.repeat(2 * 1024 * 1024)));
    });
    return req;
  };

  try {
    const { fetchGitignoreIoTemplates } = require('../src/providers/gitignore-io');
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
    const fresh = require('../src/providers/gitignore-io');

    // The implementation calls req.destroy(new Error(...)) on the over-cap
    // chunk, which then bubbles through the response 'error' / 'close' path.
    // The promise resolves via the standard rejection pathway when destroy
    // is invoked with an Error.
    let rejected = false;
    try {
      await fresh.fetchGitignoreIoTemplates(['Node']);
    } catch (err) {
      rejected = true;
      assert.match(err.message, /exceeded/);
    }
    assert.equal(rejected, true, 'oversized body must reject');
  } finally {
    https.get = origGet;
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
  }
});

test('fetchGitignoreIoTemplates rejects on response stream error', async () => {
  // If the response stream emits an error (e.g. connection reset mid-body),
  // the promise must reject rather than hanging forever. Without a
  // response.on('error') handler, the promise would never settle because
  // neither 'end' nor the request-level 'error' fires for a response stream
  // error.
  const EventEmitter = require('events');
  const https = require('https');
  const origGet = https.get;

  https.get = function mockGet(url, options, callback) {
    const req = new EventEmitter();
    req.destroy = () => {};
    const response = new EventEmitter();
    response.headers = {};
    response.statusCode = 200;
    response.setEncoding = () => {};
    process.nextTick(() => {
      callback(response);
      // Simulate a response stream error (e.g. ECONNRESET mid-body)
      setImmediate(() => response.emit('error', new Error('connection reset')));
    });
    return req;
  };

  try {
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
    const fresh = require('../src/providers/gitignore-io');

    await assert.rejects(
      fresh.fetchGitignoreIoTemplates(['Node']),
      /connection reset/
    );
  } finally {
    https.get = origGet;
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
  }
});

test('fetchGitignoreIoTemplates timeout rejects exactly once (no double-rejection)', async () => {
  // The timeout handler must not call reject() after req.destroy(), because
  // req.destroy() (even without an error argument) triggers 'error' on the
  // request in the real Node.js HTTP implementation ("socket hang up"), which
  // already triggers the error handler's reject(). A redundant reject() is
  // silently ignored by native Promises but is a fragile pattern that breaks
  // with non-native Promise implementations or rejection-tracking test
  // frameworks.
  const EventEmitter = require('events');
  const https = require('https');
  const origGet = https.get;

  let rejectCount = 0;
  https.get = function mockGet(url, options, callback) {
    const req = new EventEmitter();
    req.destroy = (err) => {
      // Real http.ClientRequest.destroy() always emits 'error' on the request
      // (typically "socket hang up"), even when called without an error argument.
      process.nextTick(() => req.emit('error', err || new Error('socket hang up')));
    };
    process.nextTick(() => req.emit('timeout'));
    return req;
  };

  try {
    const OrigPromise = Promise;
    const TrackingPromise = function(executor) {
      return new OrigPromise((resolve, reject) => {
        const trackingReject = (err) => {
          rejectCount++;
          reject(err);
        };
        executor(resolve, trackingReject);
      });
    };
    Object.assign(TrackingPromise, OrigPromise);
    TrackingPromise.resolve = OrigPromise.resolve;
    TrackingPromise.reject = OrigPromise.reject;
    TrackingPromise.all = OrigPromise.all;
    TrackingPromise.race = OrigPromise.race;
    TrackingPromise.allSettled = OrigPromise.allSettled;
    TrackingPromise.prototype = OrigPromise.prototype;

    global.Promise = TrackingPromise;
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
    const fresh = require('../src/providers/gitignore-io');

    try {
      await OrigPromise.resolve(
        fresh.fetchGitignoreIoTemplates(['Node'])
      );
      assert.fail('should have rejected');
    } catch (err) {
      assert.match(err.message, /timed out/);
    } finally {
      global.Promise = OrigPromise;
    }

    assert.equal(rejectCount, 1,
      `expected exactly 1 rejection, got ${rejectCount} — timeout handler is calling reject() after req.destroy()`);
  } finally {
    https.get = origGet;
    delete require.cache[require.resolve('../src/providers/gitignore-io')];
  }
});

test('fetchGitignoreIoTemplates rejects IGNOREKIT_GITIGNORE_IO_URL without https scheme', async () => {
  // URL validation is now the caller's responsibility (buildGitignoreIoProviderText
  // validates before calling). This test verifies that buildGitignoreIoProviderText
  // rejects a non-https env var, which is the single validation entry point.
  const { buildGitignoreIoProviderText } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'mirror.internal/gitignore';
  try {
    await assert.rejects(
      buildGitignoreIoProviderText(
        { name: 'gitignore.io', templates: ['Node'] },
        { fetchText: async () => 'node_modules/\n' }
      ),
      /IGNOREKIT_GITIGNORE_IO_URL/
    );
  } finally {
    if (origEnv === undefined) {
      delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    } else {
      process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
    }
  }
});

test('fetchGitignoreIoTemplates redacts credentials from IGNOREKIT_GITIGNORE_IO_URL in error message', async () => {
  // URL validation is now the caller's responsibility. This test verifies that
  // buildGitignoreIoProviderText redacts credentials from an http URL with
  // embedded userinfo.
  const { buildGitignoreIoProviderText } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'http://admin:s3cret@mirror.internal/gitignore';
  try {
    await assert.rejects(
      buildGitignoreIoProviderText(
        { name: 'gitignore.io', templates: ['Node'] },
        { fetchText: async () => 'node_modules/\n' }
      ),
      (err) => {
        assert.match(err.message, /must use https, not http/i,
          'error must explain the scheme requirement');
        assert.doesNotMatch(err.message, /s3cret/,
          'error must not contain the password from the URL');
        assert.doesNotMatch(err.message, /admin/,
          'error must not contain the username from the URL');
        assert.doesNotMatch(err.message, /mirror\.internal/,
          'error must not contain the hostname — may be sensitive in corporate environments');
        return true;
      }
    );
  } finally {
    if (origEnv === undefined) {
      delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    } else {
      process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
    }
  }
});

test('fetchGitignoreIoTemplates rejects https URL with userinfo (embedded credentials)', async () => {
  // URL validation is now the caller's responsibility. This test verifies that
  // buildGitignoreIoProviderText rejects an https URL with embedded credentials.
  const { buildGitignoreIoProviderText } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'https://deploy:key123@mirror.internal/gitignore';
  try {
    await assert.rejects(
      buildGitignoreIoProviderText(
        { name: 'gitignore.io', templates: ['Node'] },
        { fetchText: async () => 'node_modules/\n' }
      ),
      (err) => {
        assert.match(err.message, /credentials/i,
          'error must explain that URLs with embedded credentials are rejected');
        assert.doesNotMatch(err.message, /key123/,
          'error must not contain the password from the URL');
        assert.doesNotMatch(err.message, /mirror\.internal/,
          'error must not contain the hostname — may be sensitive in corporate environments');
        return true;
      }
    );
  } finally {
    if (origEnv === undefined) {
      delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    } else {
      process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
    }
  }
});

test('fetchGitignoreIoTemplates rejects malformed IGNOREKIT_GITIGNORE_IO_URL', async () => {
  // URL validation is now the caller's responsibility. This test verifies that
  // buildGitignoreIoProviderText rejects a malformed URL.
  const { buildGitignoreIoProviderText } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'mirror.internal/gitignore';
  try {
    await assert.rejects(
      buildGitignoreIoProviderText(
        { name: 'gitignore.io', templates: ['Node'] },
        { fetchText: async () => 'node_modules/\n' }
      ),
      /IGNOREKIT_GITIGNORE_IO_URL/
    );
  } finally {
    if (origEnv === undefined) {
      delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    } else {
      process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
    }
  }
});

test('fetchGitignoreIoTemplates redacts credentials from malformed IGNOREKIT_GITIGNORE_IO_URL in parse-failure error', async () => {
  // URL validation is now the caller's responsibility. This test verifies that
  // buildGitignoreIoProviderText redacts credentials from a malformed URL.
  const { buildGitignoreIoProviderText } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = '://s3cret@mirror.internal/gitignore';
  try {
    await assert.rejects(
      buildGitignoreIoProviderText(
        { name: 'gitignore.io', templates: ['Node'] },
        { fetchText: async () => 'node_modules/\n' }
      ),
      (err) => {
        assert.match(err.message, /IGNOREKIT_GITIGNORE_IO_URL/, 'error must mention the env var');
        assert.doesNotMatch(err.message, /s3cret/, 'error must not contain the password from the malformed URL');
        assert.doesNotMatch(err.message, /mirror\.internal/, 'error must not contain the hostname from the malformed URL');
        return true;
      }
    );
  } finally {
    if (origEnv === undefined) {
      delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    } else {
      process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
    }
  }
});

// --- Provider-branch coverage assertion ---

test('every VALID_PROVIDERS entry has a buildProviderText builder', async () => {
  // VALID_PROVIDERS and PROVIDER_BUILDERS are maintained independently — a new
  // provider added to the set without a corresponding builder in the registry
  // would throw at startup. This test verifies the runtime behavior matches:
  // calling buildProviderText for each valid provider does NOT throw
  // "Unknown provider".
  const { VALID_PROVIDERS } = require('../src/core/constants');
  const { buildProviderText } = require('../src/providers');

  for (const providerName of VALID_PROVIDERS) {
    let threw = false;
    try {
      // buildProviderText is async; use a minimal provider object. The local
      // provider needs no templates; gitignore.io needs templates and a
      // fetchText stub to avoid a real network call.
      const provider = { name: providerName };
      const options = {};
      if (providerName === 'gitignore.io') {
        provider.templates = ['Node'];
        options.fetchText = async () => '# test content\n';
      }
      await buildProviderText(provider, options);
    } catch (err) {
      if (/Unknown provider/.test(err.message)) {
        threw = true;
      }
      // Other errors (e.g. network) are acceptable — the test only checks
      // that the provider is recognized, not that it succeeds end-to-end.
    }
    assert.equal(threw, false,
      `VALID_PROVIDERS includes "${providerName}" but buildProviderText has no builder for it — ` +
      `add an entry in PROVIDER_BUILDERS (providers/index.js)`);
  }
});

test('buildProviderText rejects a provider not in VALID_PROVIDERS', async () => {
  // The inverse of the coverage test: a provider name NOT in VALID_PROVIDERS
  // must throw "Unknown provider" from buildProviderText. This ensures the
  // fallthrough is active and not accidentally disabled.
  const { buildProviderText } = require('../src/providers');
  await assert.rejects(
    buildProviderText({ name: 'nonexistent-provider' }),
    /Unknown provider/
  );
});

// --- validateProviderConfig (shared validation) ---

test('validateProviderConfig returns no errors for valid local provider', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'local' });
  assert.deepEqual(errors, []);
});

test('validateProviderConfig returns no errors for valid gitignore.io provider with templates', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'gitignore.io', templates: ['Node'] });
  assert.deepEqual(errors, []);
});

test('validateProviderConfig returns error for unknown provider', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'unknown' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown provider "unknown"/);
});

test('validateProviderConfig returns error for gitignore.io without templates', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'gitignore.io' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires non-empty templates/);
});

test('validateProviderConfig returns error for gitignore.io with empty templates', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'gitignore.io', templates: [] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires non-empty templates/);
});

test('validateProviderConfig returns error for gitignore.io with non-string templates', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'gitignore.io', templates: ['Node', 42] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must contain only strings/);
});

test('validateProviderConfig returns error for gitignore.io with non-array templates', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 'gitignore.io', templates: 'java' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires non-empty templates/);
});

test('validateProviderConfig accepts providerName override', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ templates: ['Node'] }, 'gitignore.io');
  assert.deepEqual(errors, []);
});

test('validateProviderConfig returns multiple errors for multiple violations', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  // Unknown provider + missing templates — both errors should be reported
  const errors = validateProviderConfig({ name: 'bogus' });
  assert.equal(errors.length, 1, 'unknown provider alone produces one error');
});

test('validateProviderConfig returns clear error when provider name is missing', () => {
  // When provider is an object without a .name property and providerName is
  // not provided, the old code produced "unknown provider "undefined"" which
  // is confusing. The guard must produce a clear "provider name is required"
  // message instead.
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ templates: ['Node'] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /provider name is required/);
});

test('validateProviderConfig returns clear error when provider name is empty string', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: '' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /provider name is required/);
});

test('validateProviderConfig returns clear error when provider name is not a string', () => {
  const { validateProviderConfig } = require('../src/core/constants');
  const errors = validateProviderConfig({ name: 42 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /provider name is required/);
});

// --- #4: .env detection pattern must match indented lines ---

test('buildGitignoreIoProviderText detects .env pattern with leading whitespace', async () => {
  // parseSignificantLines returns the untrimmed original line, so a gitignore
  // entry like "  .env" must still match the SECRET_LIKE_PATTERNS .env regex.
  // The ^ anchor in the old pattern /^\.env($|\.)/i would fail to match
  // because the original line starts with spaces, not ".".
  const { buildGitignoreIoProviderText } = require('../src/providers/gitignore-io');
  const stderrChunks = [];
  await buildGitignoreIoProviderText(
    { name: 'gitignore.io', templates: ['Node'] },
    {
      fetchText: async () => '  .env\nnode_modules/\n',
      stderr: { write: (chunk) => { stderrChunks.push(String(chunk)); return true; } }
    }
  );
  const stderr = stderrChunks.join('');
  assert.match(stderr, /secret filenames/, 'indented .env must be detected as a secret-like pattern');
});

test('buildGitignoreIoProviderText detects .env.production with leading whitespace', async () => {
  const { buildGitignoreIoProviderText } = require('../src/providers/gitignore-io');
  const stderrChunks = [];
  await buildGitignoreIoProviderText(
    { name: 'gitignore.io', templates: ['Node'] },
    {
      fetchText: async () => '  .env.production\n',
      stderr: { write: (chunk) => { stderrChunks.push(String(chunk)); return true; } }
    }
  );
  const stderr = stderrChunks.join('');
  assert.match(stderr, /secret filenames/, 'indented .env.production must be detected as a secret-like pattern');
});

test('buildGitignoreIoProviderText validates URL even when fetchText is provided', async () => {
  // When options.fetchText is provided (test-injection path), URL validation
  // must still run. Without this guard, a test injecting fetchText with an
  // env var pointing to an http URL or a URL with credentials would bypass
  // security validation entirely.
  const { buildGitignoreIoProviderText } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'http://mirror.internal/gitignore';
  try {
    await assert.rejects(
      buildGitignoreIoProviderText(
        { name: 'gitignore.io', templates: ['Node'] },
        { fetchText: async () => 'node_modules/\n' }
      ),
      /must use https, not http/
    );
  } finally {
    if (origEnv === undefined) delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    else process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
  }
});

// --- #5: detectNegationPatterns test coverage ---

test('detectNegationPatterns detects simple negation', () => {
  const { detectNegationPatterns } = require('../src/providers/gitignore-io');
  const result = detectNegationPatterns('node_modules/\n!keep-me\n');
  assert.deepEqual(result, ['!keep-me']);
});

test('detectNegationPatterns detects double negation', () => {
  // A double negation !!file re-includes a file that was excluded by a prior
  // negation. Git treats !!file as equivalent to file (the two !s cancel).
  // Both lines should be reported because each changes the semantics of the
  // user's .gitignore rules.
  const { detectNegationPatterns } = require('../src/providers/gitignore-io');
  const result = detectNegationPatterns('node_modules/\n!keep-me\n!!re-exclude-me\n');
  assert.deepEqual(result, ['!keep-me', '!!re-exclude-me']);
});

test('detectNegationPatterns does not match escaped literal backslash-exclamation', () => {
  // The line \!file starts with a backslash, not an exclamation mark. In
  // gitignore syntax, \!file is a literal filename containing an exclamation
  // mark, not a negation pattern. However, parseSignificantLines returns the
  // original line, and line.startsWith('!') only matches lines where the first
  // character is '!'. Since \!file starts with '\', it is correctly excluded.
  const { detectNegationPatterns } = require('../src/providers/gitignore-io');
  const result = detectNegationPatterns('\\!literal-bang\nnode_modules/\n');
  assert.deepEqual(result, [], '\\!literal-bang must not be detected as a negation');
});

test('detectNegationPatterns returns empty for content without negations', () => {
  const { detectNegationPatterns } = require('../src/providers/gitignore-io');
  const result = detectNegationPatterns('node_modules/\ndist/\n# comment\n\n');
  assert.deepEqual(result, []);
});

test('detectNegationPatterns detects negation with leading whitespace', () => {
  // parseSignificantLines returns the untrimmed original line. Git ignores
  // leading unescaped whitespace in patterns, so "  !keep-this" is a valid
  // negation that Git honors. detectNegationPatterns must detect it, just
  // as detectSecretLikePatterns already handles leading whitespace via
  // /^\s*\.env($|\.)/i.
  const { detectNegationPatterns } = require('../src/providers/gitignore-io');
  const result = detectNegationPatterns('node_modules/\n  !keep-this\n');
  assert.deepEqual(result, ['  !keep-this']);
});

test('detectNegationPatterns handles mixed content with negations', () => {
  const { detectNegationPatterns } = require('../src/providers/gitignore-io');
  const result = detectNegationPatterns(
    'node_modules/\n!important.log\ndist/\n# not a negation\n!keep-this\n\\!escaped\n'
  );
  assert.deepEqual(result, ['!important.log', '!keep-this']);
});

// --- detectSecretLikePatterns test coverage ---

test('detectSecretLikePatterns detects .env files', () => {
  const { detectSecretLikePatterns } = require('../src/providers/gitignore-io');
  const result = detectSecretLikePatterns('.env\nnode_modules/\n');
  assert.deepEqual(result, ['.env']);
});

test('detectSecretLikePatterns detects .env.production variant', () => {
  const { detectSecretLikePatterns } = require('../src/providers/gitignore-io');
  const result = detectSecretLikePatterns('.env.production\n');
  assert.deepEqual(result, ['.env.production']);
});

test('detectSecretLikePatterns detects indented .env lines', () => {
  const { detectSecretLikePatterns } = require('../src/providers/gitignore-io');
  const result = detectSecretLikePatterns('  .env\n  .env.local\n');
  assert.deepEqual(result, ['  .env', '  .env.local']);
});

test('detectSecretLikePatterns detects .pem files', () => {
  const { detectSecretLikePatterns } = require('../src/providers/gitignore-io');
  const result = detectSecretLikePatterns('cert.pem\n');
  assert.deepEqual(result, ['cert.pem']);
});

test('detectSecretLikePatterns detects .key files', () => {
  const { detectSecretLikePatterns } = require('../src/providers/gitignore-io');
  const result = detectSecretLikePatterns('deploy.key\n');
  assert.deepEqual(result, ['deploy.key']);
});

test('detectSecretLikePatterns detects id_rsa', () => {
  const { detectSecretLikePatterns } = require('../src/providers/gitignore-io');
  const result = detectSecretLikePatterns('id_rsa\n');
  assert.deepEqual(result, ['id_rsa']);
});

test('detectSecretLikePatterns returns empty for content without secret patterns', () => {
  const { detectSecretLikePatterns } = require('../src/providers/gitignore-io');
  const result = detectSecretLikePatterns('node_modules/\ndist/\n# comment\n');
  assert.deepEqual(result, []);
});

// --- #7: validateGitignoreIoUrl independent tests ---

test('validateGitignoreIoUrl returns null for the default URL', () => {
  // The function validates its baseUrl parameter, not process.env. The default
  // URL is always trusted — returning null for it means the common case (no
  // env var set) passes validation without error.
  const { validateGitignoreIoUrl, DEFAULT_GITIGNORE_IO_URL } = require('../src/providers/gitignore-io');
  const result = validateGitignoreIoUrl(DEFAULT_GITIGNORE_IO_URL);
  assert.equal(result, null);
});

test('validateGitignoreIoUrl returns null for undefined baseUrl', () => {
  // When no env var is set and no explicit URL is provided, baseUrl is
  // undefined. The function treats undefined the same as the default URL —
  // both are "no custom URL configured" and pass validation.
  const { validateGitignoreIoUrl } = require('../src/providers/gitignore-io');
  const result = validateGitignoreIoUrl(undefined);
  assert.equal(result, null);
});

test('validateGitignoreIoUrl returns error for malformed URL', () => {
  const { validateGitignoreIoUrl } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'mirror.internal/gitignore';
  try {
    const result = validateGitignoreIoUrl('mirror.internal/gitignore');
    assert.ok(result instanceof Error);
    assert.match(result.message, /not a valid URL/);
  } finally {
    if (origEnv === undefined) delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    else process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
  }
});

test('validateGitignoreIoUrl redacts credentials from malformed URL', () => {
  // When a URL containing credentials (user:pass@host) is malformed enough for
  // new URL() to reject, the entire raw baseUrl is redacted — a regex approach
  // like /^[^@]*@/ only redacts up to the first @, which is insufficient for
  // multi-@ URLs. Full redaction avoids any credential leakage.
  const { validateGitignoreIoUrl } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = '://s3cret@mirror.internal/gitignore';
  try {
    const result = validateGitignoreIoUrl('://s3cret@mirror.internal/gitignore');
    assert.ok(result instanceof Error);
    assert.doesNotMatch(result.message, /s3cret/);
    assert.doesNotMatch(result.message, /mirror\.internal/);
    assert.match(result.message, /redacted/);
  } finally {
    if (origEnv === undefined) delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    else process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
  }
});

test('validateGitignoreIoUrl returns error for http scheme', () => {
  const { validateGitignoreIoUrl } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'http://mirror.internal/gitignore';
  try {
    const result = validateGitignoreIoUrl('http://mirror.internal/gitignore');
    assert.ok(result instanceof Error);
    assert.match(result.message, /must use https, not http/);
    // Hostname must not appear in the error message — it may be sensitive in
    // corporate environments.
    assert.doesNotMatch(result.message, /mirror\.internal/);
  } finally {
    if (origEnv === undefined) delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    else process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
  }
});

test('validateGitignoreIoUrl redacts credentials from http URL error', () => {
  // The http-branch error must not include the hostname or pathname — these
  // may be sensitive in corporate environments. Only the scheme requirement
  // is communicated.
  const { validateGitignoreIoUrl } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'http://admin:s3cret@mirror.internal/gitignore';
  try {
    const result = validateGitignoreIoUrl('http://admin:s3cret@mirror.internal/gitignore');
    assert.ok(result instanceof Error);
    assert.doesNotMatch(result.message, /s3cret/);
    assert.doesNotMatch(result.message, /admin/);
    assert.doesNotMatch(result.message, /mirror\.internal/);
  } finally {
    if (origEnv === undefined) delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    else process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
  }
});

test('validateGitignoreIoUrl returns error for https URL with credentials', () => {
  // The embedded-credentials error must not include the hostname or pathname —
  // these may be sensitive in corporate environments. Only the credential
  // prohibition is communicated.
  const { validateGitignoreIoUrl } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'https://deploy:key123@mirror.internal/gitignore';
  try {
    const result = validateGitignoreIoUrl('https://deploy:key123@mirror.internal/gitignore');
    assert.ok(result instanceof Error);
    assert.match(result.message, /credentials/);
    assert.doesNotMatch(result.message, /key123/);
    assert.doesNotMatch(result.message, /mirror\.internal/);
  } finally {
    if (origEnv === undefined) delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    else process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
  }
});

test('validateGitignoreIoUrl returns null for valid https URL without credentials', () => {
  const { validateGitignoreIoUrl } = require('../src/providers/gitignore-io');
  const origEnv = process.env.IGNOREKIT_GITIGNORE_IO_URL;
  process.env.IGNOREKIT_GITIGNORE_IO_URL = 'https://mirror.internal/gitignore';
  try {
    const result = validateGitignoreIoUrl('https://mirror.internal/gitignore');
    assert.equal(result, null);
  } finally {
    if (origEnv === undefined) delete process.env.IGNOREKIT_GITIGNORE_IO_URL;
    else process.env.IGNOREKIT_GITIGNORE_IO_URL = origEnv;
  }
});
