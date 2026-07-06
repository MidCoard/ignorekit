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
