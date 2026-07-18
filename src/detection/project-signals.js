'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonOrNull } = require('../core/json');

function packageNames(packageJson) {
  return new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {})
  ]);
}

function packageScripts(packageJson) {
  return Object.values(packageJson.scripts || {}).join('\n');
}

/**
 * Detect project-type signals from manifest files and build configurations.
 *
 * Returns an array of { preset, evidence, strength } objects. Each signal
 * suggests a preset that matches the project's detected technology stack.
 *
 * Priority contract for package.json framework detection:
 * The `else if` chain is intentional — when a project has multiple framework
 * dependencies (e.g. both `next` and `vite`), only the highest-priority
 * framework signal is emitted. This prevents a single project from generating
 * conflicting preset suggestions that would distort scoring. The priority
 * order is: next > nuxt > sveltekit > angular > vite > generic-node.
 * Frameworks lower in the chain are typically dependencies of those higher
 * (e.g. Vite is a dev dependency of Nuxt and SvelteKit), so the more
 * specific framework must win. If independent signals are needed (e.g. a
 * monorepo with both a Next.js app and a Vite library), the caller should
 * inspect package.json directly rather than relying on this heuristic.
 *
 * Non-package.json signals (Gradle, Maven, Python, Rust, Go, PHP) are
 * independent — each manifest file emits its own signal because a project
 * can legitimately have multiple language stacks (e.g. a Java backend with
 * a Python build script).
 *
 * @param {string} projectPath - Root directory of the project to scan
 * @param {object} [env] - Environment streams
 * @param {object} [env.stderr] - Writable stream for warnings (default: process.stderr)
 * @returns {{ preset: string, evidence: string, strength: number }[]}
 */
function detectProjectSignals(projectPath, env) {
  const stderr = (env && env.stderr) || process.stderr;
  const signals = [];
  const packageJsonPath = path.join(projectPath, 'package.json');
  let packageJson;
  let packageJsonTooLarge = false;
  try {
    packageJson = readJsonOrNull(packageJsonPath, env);
  } catch (err) {
    // readJsonOrNull re-throws size-guard errors (err.code === 'EFILETOOLARGE')
    // to avoid silently masking corruption. Signal detection is supplementary,
    // not critical — degrade gracefully by proceeding without Node.js signals,
    // matching the EACCES/invalid-JSON degradation pattern below.
    if (err && err.code === 'EFILETOOLARGE') {
      stderr.write(
        `[ignorekit] Warning: ${packageJsonPath} is too large to read. ` +
        'Node.js framework signals will not be detected. Set IGNOREKIT_DEBUG=1 for details.\n'
      );
      packageJson = null;
      packageJsonTooLarge = true;
    } else {
      throw err;
    }
  }

  if (packageJson) {
    const names = packageNames(packageJson);
    const scripts = packageScripts(packageJson);
    if (names.has('next')) {
      signals.push({ preset: 'next', evidence: 'Next.js detected in package.json', strength: 1000 });
    } else if (names.has('nuxt')) {
      signals.push({ preset: 'nuxt', evidence: 'Nuxt detected in package.json', strength: 1000 });
    } else if (names.has('@sveltejs/kit')) {
      signals.push({ preset: 'sveltekit', evidence: 'SvelteKit detected in package.json', strength: 1000 });
    } else if (names.has('@angular/core')) {
      signals.push({ preset: 'angular', evidence: 'Angular detected in package.json', strength: 1000 });
    } else if (names.has('vite') || /\bvite\b/.test(scripts)) {
      signals.push({ preset: 'vite', evidence: 'Vite detected in package.json', strength: 1000 });
    } else {
      signals.push({ preset: 'node', evidence: 'Node.js package detected', strength: 400 });
    }
  } else if (!packageJsonTooLarge && fs.existsSync(packageJsonPath)) {
    // package.json exists but readJsonOrNull returned null — the file is
    // present but unreadable (EACCES) or contains invalid JSON. The caller
    // will not detect any Node.js framework signals, which is a silent
    // misconfiguration. Surface a warning so the user can diagnose the
    // permission issue or corrupt file.
    // The "too large" case is excluded because it already produced its own
    // specific warning above — a generic "could not be read" message would
    // be misleading for an oversized file.
    stderr.write(
      `[ignorekit] Warning: ${packageJsonPath} exists but could not be read. ` +
      'Check file permissions and JSON syntax. Set IGNOREKIT_DEBUG=1 for details.\n'
    );
  }

  if (fs.existsSync(path.join(projectPath, 'build.gradle')) || fs.existsSync(path.join(projectPath, 'build.gradle.kts'))) {
    signals.push({ preset: 'java-gradle', evidence: 'Gradle build detected', strength: 900 });
  }
  if (fs.existsSync(path.join(projectPath, 'pom.xml'))) {
    signals.push({ preset: 'java-maven', evidence: 'Maven build detected', strength: 900 });
  }
  if (fs.existsSync(path.join(projectPath, 'pyproject.toml')) || fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
    signals.push({ preset: 'python', evidence: 'Python project manifest detected', strength: 700 });
  }
  if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) {
    signals.push({ preset: 'rust', evidence: 'Cargo manifest detected', strength: 900 });
  }
  if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    signals.push({ preset: 'go', evidence: 'Go module detected', strength: 900 });
  }
  if (fs.existsSync(path.join(projectPath, 'composer.json'))) {
    signals.push({ preset: 'php', evidence: 'Composer manifest detected', strength: 900 });
  }

  const byPreset = new Map();
  for (const signal of signals) {
    const existing = byPreset.get(signal.preset);
    if (!existing || signal.strength > existing.strength) {
      byPreset.set(signal.preset, signal);
    }
  }
  return [...byPreset.values()];
}

module.exports = { detectProjectSignals };
