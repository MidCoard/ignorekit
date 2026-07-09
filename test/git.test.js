'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { getGitState } = require('../src/git');

test('getGitState detects a repo root by .git directory', () => {
  const workspace = createTempWorkspace();
  try {
    fs.mkdirSync(workspace.path('project/.git'), { recursive: true });
    assert.equal(getGitState(workspace.path('project')).state, 'repo-root');
  } finally {
    workspace.cleanup();
  }
});

test('getGitState detects a worktree or submodule by .git file', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.git', 'gitdir: ../.git/worktrees/project\n');
    assert.equal(getGitState(workspace.path('project')).state, 'git-file');
  } finally {
    workspace.cleanup();
  }
});

test('getGitState returns not-a-repo when no .git exists', () => {
  const workspace = createTempWorkspace();
  try {
    assert.equal(getGitState(workspace.path('project')).state, 'not-a-repo');
  } finally {
    workspace.cleanup();
  }
});

test('removeCachedFiles batches git rm --cached calls in chunks of 500', () => {
  const workspace = createTempWorkspace();
  try {
    const origSpawn = require('child_process').spawnSync;
    const calls = [];
    require('child_process').spawnSync = function (...args) {
      calls.push(args);
      return { status: 0, stderr: '' };
    };

    try {
      const { removeCachedFiles } = require('../src/git');
      // Clear require cache so we get the fresh module
      delete require.cache[require.resolve('../src/git')];
      const fresh = require('../src/git');

      const files = [];
      for (let i = 0; i < 750; i++) {
        files.push(`file${i}.txt`);
      }

      fresh.removeCachedFiles(workspace.path('project'), files);

      // Should be 2 calls: 500 + 250
      assert.equal(calls.length, 2);
      // Each call: spawnSync('git', ['rm', '--cached', '--', ...files], options)
      // args array has 3 prefix items ('rm', '--cached', '--') plus the files
      assert.equal(calls[0][1].length - 3, 500); // 500 files in first batch
      assert.equal(calls[1][1].length - 3, 250); // 250 files in second batch
    } finally {
      require('child_process').spawnSync = origSpawn;
      delete require.cache[require.resolve('../src/git')];
    }
  } finally {
    workspace.cleanup();
  }
});
