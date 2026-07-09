'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { DIST_ROOT } = require('../core/path');
const { buildProjectConfig } = require('../config/build-config');
const { createDefinitionResolver } = require('../definitions/resolver');
const { generateGitignore } = require('../generator');
const { ensureGitRepo } = require('../git');

async function runInitWorkflow(options, env) {
  const projectPath = path.resolve(env.cwd || process.cwd(), options.projectPath);
  fs.mkdirSync(projectPath, { recursive: true });

  const config = buildProjectConfig(path.basename(projectPath), options);

  const configPath = path.join(projectPath, 'ignorekit.json');
  if (fs.existsSync(configPath) && !options.overwrite) {
    throw new Error(`Config already exists: ${configPath}`);
  }
  writeJson(configPath, config);

  const resolver = createDefinitionResolver({
    distRoot: options.distRoot || DIST_ROOT,
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
