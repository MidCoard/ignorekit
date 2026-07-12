'use strict';

const fs = require('fs');
const path = require('path');

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

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

function detectProjectSignals(projectPath) {
  const signals = [];
  const packageJson = readJsonIfPresent(path.join(projectPath, 'package.json'));

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
