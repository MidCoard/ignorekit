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
  }), /provider.templates must be an array/);
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

test('buildProjectConfig includes provider.templates when provider is not local and templates are provided', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'gitignore.io', templates: ['Node', 'Python'] });
  assert.deepEqual(config.provider, { name: 'gitignore.io', templates: ['Node', 'Python'] });
});

test('buildProjectConfig omits provider.templates when provider is local', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'local', templates: ['Node'] });
  assert.deepEqual(config.provider, { name: 'local' });
});

test('buildProjectConfig omits provider.templates when templates array is empty', () => {
  const { buildProjectConfig } = require('../src/config/build-config');
  const config = buildProjectConfig('demo', { provider: 'gitignore.io', templates: [] });
  assert.deepEqual(config.provider, { name: 'gitignore.io' });
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
  // The original guard only checked `body.length > MAX_BYTES` after each chunk
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

test('fetchGitignoreIoTemplates rejects when body+chunk exceeds MAX_BYTES', async () => {
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
