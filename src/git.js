'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

function getGitState(projectPath) {
  const dotGit = path.join(projectPath, '.git');
  if (fs.existsSync(dotGit)) {
    const stat = fs.statSync(dotGit);
    return { state: stat.isDirectory() ? 'repo-root' : 'git-file', path: dotGit };
  }
  const result = childProcess.spawnSync('git', ['-C', projectPath, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8'
  });
  if (result.status === 0) {
    return { state: 'inside-parent-repo', root: result.stdout.trim() };
  }
  return { state: 'not-a-repo' };
}

function ensureGitRepo(projectPath, options = {}) {
  const state = getGitState(projectPath);
  if (state.state === 'repo-root' || state.state === 'git-file') {
    return { action: 'skipped', reason: state.state };
  }
  if (state.state === 'inside-parent-repo' && !options.allowNested) {
    throw new Error(`Refusing to initialize nested Git repo inside ${state.root}`);
  }
  const result = childProcess.spawnSync('git', ['init'], {
    cwd: projectPath,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git init failed');
  }
  return { action: 'initialized' };
}

function listTrackedIgnoredFiles(projectPath) {
  const result = childProcess.spawnSync('git', ['ls-files', '-ci', '--exclude-standard', '-z'], {
    cwd: projectPath,
    encoding: 'buffer'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString('utf8') || 'git ls-files failed');
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function removeCachedFiles(projectPath, files, options = {}) {
  if (files.length === 0) {
    return { action: 'none', files: [] };
  }
  if (options.dryRun) {
    return { action: 'dry-run', files };
  }
  const result = childProcess.spawnSync('git', ['rm', '--cached', '--', ...files], {
    cwd: projectPath,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git rm --cached failed');
  }
  return { action: 'removed', files };
}

module.exports = { getGitState, ensureGitRepo, listTrackedIgnoredFiles, removeCachedFiles };
