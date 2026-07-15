'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Translate a spawnSync result for git into either a thrown error or the
 * captured stderr string. When the git binary is missing entirely,
 * spawnSync returns `result.error` (an Error) and leaves `result.stderr`
 * undefined — touching it then throws a TypeError that masks the real
 * "git not found" message. Check `result.error` first, then fall back to
 * stderr (stringified because `encoding: 'buffer'` returns Buffers).
 */
function gitErrorOrStderr(result, fallbackMessage) {
  if (result.error) {
    return new Error(`${fallbackMessage}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr == null ? '' : result.stderr.toString('utf8');
    return new Error(stderr || fallbackMessage);
  }
  return null;
}

function getGitState(projectPath) {
  const dotGit = path.join(projectPath, '.git');
  if (fs.existsSync(dotGit)) {
    const stat = fs.statSync(dotGit);
    return { state: stat.isDirectory() ? 'repo-root' : 'git-file', path: dotGit };
  }
  const result = childProcess.spawnSync('git', ['-C', projectPath, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8'
  });
  const failure = gitErrorOrStderr(result, 'git rev-parse failed');
  if (failure) {
    if (result.error && result.error.code === 'ENOENT') {
      // git binary missing — not a repo, and there's no point reporting a
      // "git failure" because the user simply doesn't have git installed.
      return { state: 'not-a-repo', reason: 'git-not-found' };
    }
    return { state: 'not-a-repo' };
  }
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
  const failure = gitErrorOrStderr(result, 'git init failed');
  if (failure) throw failure;
  return { action: 'initialized' };
}

function listTrackedIgnoredFiles(projectPath) {
  const result = childProcess.spawnSync('git', ['ls-files', '-ci', '--exclude-standard', '-z'], {
    cwd: projectPath,
    encoding: 'buffer'
  });
  const failure = gitErrorOrStderr(result, 'git ls-files failed');
  if (failure) throw failure;
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function removeCachedFiles(projectPath, files, options = {}) {
  if (files.length === 0) {
    return { action: 'none', files: [] };
  }
  if (options.dryRun) {
    return { action: 'dry-run', files };
  }
  // Reject filenames containing newlines or null bytes. The `--` separator
  // prevents option injection, but a newline in a filename would cause
  // spawnSync to split it across argument boundaries, and a null byte
  // truncates the string. Both are pathological for version-controlled
  // files and indicate a corrupted git index rather than legitimate paths.
  for (const file of files) {
    if (file.includes('\n') || file.includes('\r') || file.includes('\0')) {
      throw new Error(`Refusing to pass filename with control characters to git: ${JSON.stringify(file)}`);
    }
  }
  const BATCH = 500;
  const removed = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const result = childProcess.spawnSync('git', ['rm', '--cached', '--', ...batch], {
      cwd: projectPath,
      encoding: 'utf8'
    });
    const failure = gitErrorOrStderr(result, 'git rm --cached failed');
    if (failure) throw failure;
    removed.push(...batch);
  }
  return { action: 'removed', files: removed };
}

module.exports = { getGitState, ensureGitRepo, listTrackedIgnoredFiles, removeCachedFiles };
