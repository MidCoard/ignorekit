'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { createDefinitionResolver } = require('../definitions/resolver');
const { generateGitignore } = require('../generator');
const { listTrackedIgnoredFiles, removeCachedFiles } = require('../git');

async function runAdoptWorkflow(options, env) {
  const projectPath = path.resolve(env.cwd || process.cwd(), options.projectPath);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  const config = {
    version: 1,
    name: path.basename(projectPath),
    preset: options.preset,
    provider: { name: options.provider || 'local' },
    components: options.components || [],
    custom: [],
    addons: {}
  };

  const configPath = path.join(projectPath, 'ignorekit.json');
  if (!fs.existsSync(configPath) || options.overwriteConfig) {
    writeJson(configPath, config);
  }

  const resolver = createDefinitionResolver({
    distRoot: options.distRoot || path.resolve(__dirname, '..', '..'),
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: projectPath
  });
  const gitignore = await generateGitignore({ config, resolver });
  const outputName = options.apply ? '.gitignore' : '.gitignore.preview';
  fs.writeFileSync(path.join(projectPath, outputName), gitignore, 'utf8');

  let cachedRemoval = { action: 'skipped', files: [] };
  if (options.removeCached) {
    const files = listTrackedIgnoredFiles(projectPath);
    cachedRemoval = removeCachedFiles(projectPath, files, { dryRun: !options.yes });
  }

  return { projectPath, configPath, cachedRemoval };
}

module.exports = { runAdoptWorkflow };
