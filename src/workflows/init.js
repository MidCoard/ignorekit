'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { buildProjectConfig } = require('../config/build-config');
const { buildResolver } = require('../cli/resolver-factory');
const { generateGitignore } = require('../generator');
const { getGitState, ensureGitRepo } = require('../git');

async function runInitWorkflow(options, env) {
  const projectPath = path.resolve(env.cwd || process.cwd(), options.projectPath);
  fs.mkdirSync(projectPath, { recursive: true });

  const config = buildProjectConfig(path.basename(projectPath), options);

  const configPath = path.join(projectPath, 'ignorekit.json');
  if (fs.existsSync(configPath) && !options.overwrite) {
    throw new Error(`Config already exists: ${configPath}`);
  }
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (fs.existsSync(gitignorePath) && !options.overwrite) {
    throw new Error(`Ignore file already exists: ${gitignorePath}. Use --overwrite to replace it.`);
  }

  if (options.git) {
    const gitState = getGitState(projectPath);
    if (gitState.state === 'inside-parent-repo' && !options.allowNestedGit) {
      throw new Error(`Refusing to initialize nested Git repo inside ${gitState.root}`);
    }
  }

  const resolver = buildResolver({ options, projectDirHint: projectPath });
  const gitignore = await generateGitignore({ config, resolver });

  writeJson(configPath, config);
  fs.writeFileSync(gitignorePath, gitignore, 'utf8');

  const git = options.git
    ? ensureGitRepo(projectPath, { allowNested: options.allowNestedGit })
    : null;

  return { projectPath, configPath, git };
}

module.exports = { runInitWorkflow };
