'use strict';

const assert = require('assert');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { detectProjectSignals } = require('../src/detection/project-signals');

test('detects Vite from package.json scripts and dependencies', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('project/package.json', {
      scripts: { dev: 'vite', build: 'vite build' },
      devDependencies: { vite: '^5.0.0' }
    });

    assert.deepEqual(detectProjectSignals(workspace.path('project')), [{
      preset: 'vite',
      evidence: 'Vite detected in package.json',
      strength: 1000
    }]);
  } finally {
    workspace.cleanup();
  }
});

test('detects Gradle and Maven without reading source files', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('gradle/build.gradle', 'plugins { id \'java\' }\n');
    workspace.writeText('maven/pom.xml', '<project/>\n');

    assert.deepEqual(detectProjectSignals(workspace.path('gradle')), [{
      preset: 'java-gradle',
      evidence: 'Gradle build detected',
      strength: 900
    }]);
    assert.deepEqual(detectProjectSignals(workspace.path('maven')), [{
      preset: 'java-maven',
      evidence: 'Maven build detected',
      strength: 900
    }]);
  } finally {
    workspace.cleanup();
  }
});

test('prefers a framework-specific signal over a shared Vite dependency', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeJson('project/package.json', {
      dependencies: { nuxt: '^3.0.0' },
      devDependencies: { vite: '^5.0.0' }
    });

    assert.deepEqual(detectProjectSignals(workspace.path('project')), [{
      preset: 'nuxt',
      evidence: 'Nuxt detected in package.json',
      strength: 1000
    }]);
  } finally {
    workspace.cleanup();
  }
});

test('returns no signal for a project without standard manifests', () => {
  const workspace = createTempWorkspace();
  try {
    assert.deepEqual(detectProjectSignals(workspace.root), []);
  } finally {
    workspace.cleanup();
  }
});

test('warns on stderr when package.json exists but is unreadable', () => {
  const workspace = createTempWorkspace();
  try {
    // Write an invalid JSON file — readJsonOrNull returns null for
    // SyntaxError, and the file exists, so the warning path is triggered.
    workspace.writeText('project/package.json', '{invalid json!!!');
    const stderrChunks = [];
    const signals = detectProjectSignals(workspace.path('project'), {
      stderr: { write: (chunk) => { stderrChunks.push(String(chunk)); return true; } }
    });
    // No Node.js signal because the JSON could not be parsed
    assert.ok(!signals.some(s => s.preset === 'node'),
      'should not detect node signal when package.json is invalid');
    // A warning must have been written to stderr
    const stderr = stderrChunks.join('');
    assert.match(stderr, /Warning.*package\.json.*could not be read/);
  } finally {
    workspace.cleanup();
  }
});

test('detectProjectSignals degrades gracefully when package.json is too large', () => {
  // readJsonOrNull re-throws "File too large" errors rather than returning
  // null, because an oversized config file is a strong corruption signal.
  // detectProjectSignals must catch that throw and degrade gracefully (no
  // Node.js signals, warning on stderr) instead of crashing the entire
  // analysis pipeline — matching the existing EACCES/invalid-JSON degradation
  // pattern for package.json.
  const { MAX_CONTENT_BYTES } = require('../src/core/constants');
  const workspace = createTempWorkspace();
  try {
    const padding = '\n'.repeat(MAX_CONTENT_BYTES + 1);
    workspace.writeText('project/package.json', `{"name": "test"}${padding}`);
    const stderrChunks = [];
    const signals = detectProjectSignals(workspace.path('project'), {
      stderr: { write: (chunk) => { stderrChunks.push(String(chunk)); return true; } }
    });
    // No Node.js signal because the file was too large to read
    assert.ok(!signals.some(s => s.preset === 'node'),
      'should not detect node signal when package.json is too large');
    // A warning must have been written to stderr
    const stderr = stderrChunks.join('');
    assert.match(stderr, /Warning.*package\.json.*too large/);
    // Only one warning — the "too large" warning must suppress the generic
    // "could not be read" warning that fires for EACCES/invalid-JSON, because
    // "check file permissions and JSON syntax" is misleading for an oversized file.
    const warningCount = (stderr.match(/Warning/g) || []).length;
    assert.equal(warningCount, 1, `expected exactly 1 warning, got ${warningCount}: ${stderr}`);
  } finally {
    workspace.cleanup();
  }
});

test('readJsonOrNull re-throws size-guard errors instead of returning null', () => {
  // An oversized JSON file is a strong signal of corruption or attack — silently
  // returning null masks the problem. The size-guard error from checkSize must
  // propagate rather than being swallowed by the generic catch in readJsonOrNull.
  const { readJsonOrNull } = require('../src/core/json');
  const { MAX_CONTENT_BYTES } = require('../src/core/constants');
  const workspace = createTempWorkspace();
  try {
    // Create a file larger than MAX_CONTENT_BYTES
    const padding = '\n'.repeat(MAX_CONTENT_BYTES + 1);
    workspace.writeText('project/huge.json', `{"name": "test"}${padding}`);

    assert.throws(
      () => readJsonOrNull(workspace.path('project/huge.json')),
      /File too large/
    );
  } finally {
    workspace.cleanup();
  }
});

test('checkSize sets err.code to EFILETOOLARGE for oversized files', () => {
  // The error code EFILETOOLARGE decouples the thrower (checkSize) from the
  // catcher (readJsonOrNull, detectProjectSignals) so that changing the error
  // message format in checkSize doesn't silently break the re-throw logic.
  // String-matching on err.message is fragile — if the message format changes,
  // oversized files would silently return null again.
  const { readJsonOrNull } = require('../src/core/json');
  const { MAX_CONTENT_BYTES } = require('../src/core/constants');
  const workspace = createTempWorkspace();
  try {
    const padding = '\n'.repeat(MAX_CONTENT_BYTES + 1);
    workspace.writeText('project/huge.json', `{"name": "test"}${padding}`);

    let caughtCode = null;
    try {
      readJsonOrNull(workspace.path('project/huge.json'));
    } catch (err) {
      caughtCode = err.code;
    }
    assert.equal(caughtCode, 'EFILETOOLARGE',
      'size-guard errors must have err.code === "EFILETOOLARGE" for reliable detection');
  } finally {
    workspace.cleanup();
  }
});

test('detectProjectSignals catches size-guard errors by code, not message', () => {
  // detectProjectSignals must degrade gracefully when package.json is too large,
  // catching the error by err.code rather than by string-matching the message.
  // This ensures the graceful-degradation path remains working even if the
  // error message format in checkSize changes.
  const { MAX_CONTENT_BYTES } = require('../src/core/constants');
  const workspace = createTempWorkspace();
  try {
    const padding = '\n'.repeat(MAX_CONTENT_BYTES + 1);
    workspace.writeText('project/package.json', `{"name": "test"}${padding}`);
    const stderrChunks = [];
    // This must NOT throw — detectProjectSignals catches the error by code
    // and degrades gracefully.
    const signals = detectProjectSignals(workspace.path('project'), {
      stderr: { write: (chunk) => { stderrChunks.push(String(chunk)); return true; } }
    });
    assert.ok(!signals.some(s => s.preset === 'node'),
      'should not detect node signal when package.json is too large');
    const stderr = stderrChunks.join('');
    assert.match(stderr, /too large/);
  } finally {
    workspace.cleanup();
  }
});

// --- #7 (Round 8): readJsonOrNull must warn on EACCES unconditionally ---

test('readJsonOrNull writes EACCES warning to stderr unconditionally (not only under IGNOREKIT_DEBUG)', () => {
  // A permission error on a config file is a real misconfiguration that the
  // user needs to know about, even without debug mode. The warning must
  // appear on stderr regardless of IGNOREKIT_DEBUG.
  const { readJsonOrNull } = require('../src/core/json');
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/config.json', '{"key": "value"}');
    const filePath = workspace.path('project/config.json');

    // Mock fs.readFileSync to throw EACCES
    const fs = require('fs');
    const origReadFileSync = fs.readFileSync;
    fs.readFileSync = function(path, encoding) {
      if (path === filePath) {
        const err = new Error('EACCES: permission denied');
        err.code = 'EACCES';
        throw err;
      }
      return origReadFileSync.call(this, path, encoding);
    };

    try {
      const stderrChunks = [];
      const result = readJsonOrNull(filePath, {
        stderr: { write: (chunk) => { stderrChunks.push(String(chunk)); return true; } }
      });

      // readJsonOrNull must still return null (preserving its contract)
      assert.equal(result, null);

      // But it must also write an unconditional EACCES warning to stderr
      const stderr = stderrChunks.join('');
      assert.match(stderr, /permission denied/i, 'EACCES warning must appear on stderr unconditionally');
    } finally {
      fs.readFileSync = origReadFileSync;
    }
  } finally {
    workspace.cleanup();
  }
});
