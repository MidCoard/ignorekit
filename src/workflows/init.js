'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { buildProjectConfig } = require('../config/build-config');
const { buildResolver } = require('../core/resolver-factory');
const { generateGitignore } = require('../generator');
const { getGitState, ensureGitRepo } = require('../git');
const { extractStreams } = require('../core/env');

/**
 * Run the init workflow.
 *
 * Creates an ignorekit.json config and generates a .gitignore in the target
 * project directory. Before writing, a preview of the generated .gitignore is
 * shown and the user is asked to confirm (unless --yes is set or stdin is not
 * a TTY). This matches the confirm-gate pattern used by adopt and create.
 *
 * @param {object} options
 * @param {string} options.projectPath - Directory to initialize
 * @param {string} options.preset - Preset name
 * @param {boolean} [options.git] - Run git init
 * @param {boolean} [options.overwrite] - Replace existing ignorekit.json and .gitignore
 * @param {boolean} [options.allowNestedGit] - Allow initializing a nested Git repo
 * @param {string[]} [options.components] - Extra component IDs
 * @param {string[]} [options.exclude] - Component IDs to exclude
 * @param {string[]} [options.templates] - Provider templates
 * @param {string} [options.distRoot] - Override dist root
 * @param {string} [options.userRoot] - User-level override directory
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {object} [env.stderr] - Writable stream for errors
 * @param {string} [env.cwd] - Current working directory
 * @param {Function} [env.confirm] - Async callback returning boolean
 * @returns {Promise<{ projectPath: string, configPath: string|null, git: object|null }>}
 */
async function runInitWorkflow(options, env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  const projectPath = path.resolve(cwd, options.projectPath);
  fs.mkdirSync(projectPath, { recursive: true });

  const config = buildProjectConfig(path.basename(projectPath), options);

  // Overwrite guards fire BEFORE any generation or preview. A user who already
  // has an ignorekit.json or .gitignore on disk should learn "already exists"
  // first; generating a preview only to throw on a file-exists check at the
  // end is wasted work and produces misleading output.
  // Init uses --overwrite for both config and .gitignore because init creates
  // both files from scratch — there is no scenario where overwriting one but
  // not the other makes sense. Adopt uses --overwrite-config because it has
  // a separate --apply gate for the .gitignore, so the two overwrite decisions
  // must be independent. Renaming either flag would be a breaking change for
  // existing scripts and CI pipelines.
  const configPath = path.join(projectPath, 'ignorekit.json');
  if (fs.existsSync(configPath) && !options.overwrite) {
    throw new Error(`Config already exists: ${configPath}. Use --overwrite to replace it.`);
  }
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (fs.existsSync(gitignorePath) && !options.overwrite) {
    throw new Error(`.gitignore already exists: ${gitignorePath}. Use --overwrite to replace it.`);
  }

  if (options.git) {
    const gitState = getGitState(projectPath);
    if (gitState.state === 'inside-parent-repo' && !options.allowNestedGit) {
      throw new Error(`Refusing to initialize nested Git repo inside ${gitState.root}`);
    }
  }

  const resolver = buildResolver({ options, env, projectDirHint: projectPath });
  const gitignore = await generateGitignore({ config, resolver, env });

  // Preview: ask instead of auto-showing. When --preview is passed, show the
  // preview directly (the flag is the explicit answer). When the flag is NOT
  // passed, ask interactively. In non-interactive mode (no env.ask), skip the
  // preview entirely — CI doesn't need a preview unless explicitly requested.
  if (options.preview) {
    stdout.write(`\n--- Preview (.gitignore) ---\n`);
    stdout.write(gitignore);
    stdout.write(`--- End preview ---\n\n`);
  } else if (env.ask) {
    const showPreview = await env.ask('Show preview of generated .gitignore? [Y/n]: ');
    if (!showPreview || showPreview.trim().toLowerCase() !== 'n') {
      stdout.write(`\n--- Preview (.gitignore) ---\n`);
      stdout.write(gitignore);
      stdout.write(`--- End preview ---\n\n`);
    } else {
      stdout.write('Preview skipped.\n');
    }
  }

  // Confirm before writing (if env.confirm provided). The CLI dispatch routes
  // through buildCreateEnv so --yes skips the confirm, and non-interactive
  // environments (CI, piped stdin) get no confirm callback at all.
  if (env.confirm) {
    const proceed = await env.confirm('Write ignorekit.json and .gitignore? [Y/n]: ');
    if (!proceed) {
      stdout.write('Cancelled — no files written.\n');
      return { projectPath, configPath: null, git: null };
    }
  }

  writeJson(configPath, config);
  fs.writeFileSync(gitignorePath, gitignore, 'utf8');

  const git = options.git
    ? ensureGitRepo(projectPath, { allowNested: options.allowNestedGit })
    : null;

  return { projectPath, configPath, git };
}

module.exports = { runInitWorkflow };
