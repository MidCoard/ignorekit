'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { createDefinitionResolver } = require('../definitions/resolver');
const { generateGitignore } = require('../generator');
const { ensureGitRepo } = require('../git');

async function runInitWorkflow(options, env) {
  const projectPath = path.resolve(env.cwd || process.cwd(), options.projectPath);
  fs.mkdirSync(projectPath, { recursive: true });

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
  if (fs.existsSync(configPath) && !options.overwrite) {
    throw new Error(`Config already exists: ${configPath}`);
  }
  writeJson(configPath, config);

  const resolver = createDefinitionResolver({
    distRoot: options.distRoot || path.resolve(__dirname, '..', '..'),
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: projectPath
  });
  const gitignore = await generateGitignore({ config, resolver });
  fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore, 'utf8');

  if (options.git) {
    ensureGitRepo(projectPath, { allowNested: options.allowNestedGit });
  }

  return { projectPath, configPath };
}

module.exports = { runInitWorkflow };
