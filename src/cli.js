'use strict';

const fs = require('fs');
const path = require('path');
const { legacyCommands, runLegacyCommand } = require('./legacy-cli');
const { readJson } = require('./core/json');
const { createDefinitionResolver } = require('./definitions/resolver');
const { generateGitignore } = require('./generator');
const { runInitWorkflow } = require('./workflows/init');
const { runAdoptWorkflow } = require('./workflows/adopt');
const { runExtractComponent } = require('./workflows/extract');
const { runPresetCreate } = require('./workflows/preset');

const legacyAliases = new Map([
  ['ls', 'list'],
  ['verify', 'check']
]);

function parseArgs(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const booleanOptions = new Set(['all', 'yes', 'git', 'noGit', 'dryRun', 'preview', 'overwrite', 'overwriteConfig', 'removeCached', 'allowNestedGit', 'apply']);
    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Option ${arg} requires a value.`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function collectRepeated(args, optionName) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === optionName && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function printHelp(stdout) {
  stdout.write(`ignorekit

Usage:
  ignorekit list [components|presets|projects]
  ignorekit generate <config>
  ignorekit init <project-path>
  ignorekit adopt <project-path>
  ignorekit extract component <id> --from <path>
  ignorekit preset create <name>

Legacy:
  ignorekit build <project> [--root <root>]
  ignorekit check <project> [--root <root>]
  ignorekit diff <project> [--root <root>]
  ignorekit apply <project> [--root <root>] [--yes]
`);
}

function createResolverFromOptions(options, configPath) {
  const projectRoot = path.dirname(path.resolve(configPath));
  return createDefinitionResolver({
    distRoot: options.distRoot || path.resolve(__dirname, '..'),
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot
  });
}

async function commandGenerate(args, env) {
  const options = parseArgs(args);
  const configPath = options._[0];
  if (!configPath) {
    throw new Error('generate requires a config path');
  }
  const absoluteConfigPath = path.resolve(env.cwd || process.cwd(), configPath);
  const config = readJson(absoluteConfigPath);
  const resolver = createResolverFromOptions(options, absoluteConfigPath);
  const content = await generateGitignore({ config, resolver });
  const outputPath = path.resolve(path.dirname(absoluteConfigPath), options.output || '.gitignore');
  fs.writeFileSync(outputPath, content, 'utf8');
  env.stdout.write(`Generated ${outputPath}\n`);
}

async function runCli(args, env = {}) {
  const stdout = env.stdout || process.stdout;
  const stderr = env.stderr || process.stderr;
  const rawCommand = args[0] || 'help';
  const command = legacyAliases.get(rawCommand) || rawCommand;

  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp(stdout);
      return { exitCode: 0 };
    }
    if (legacyCommands.has(command)) {
      return await runLegacyCommand(command, args.slice(1), env);
    }
    if (command === 'generate') {
      await commandGenerate(args.slice(1), { stdout, stderr, cwd: env.cwd });
      return { exitCode: 0 };
    }
    if (command === 'init') {
      const options = parseArgs(args.slice(1));
      options.projectPath = options._[0];
      if (!options.projectPath) {
        throw new Error('init requires a project path');
      }
      if (!options.preset) {
        throw new Error('init requires --preset');
      }
      options.git = Boolean(options.git);
      if (options.noGit) {
        options.git = false;
      }
      const result = await runInitWorkflow(options, { cwd: env.cwd });
      stdout.write(`Initialized ignorekit project at ${result.projectPath}\n`);
      return { exitCode: 0 };
    }
    if (command === 'adopt') {
      const options = parseArgs(args.slice(1));
      options.projectPath = options._[0];
      if (!options.projectPath) {
        throw new Error('adopt requires a project path');
      }
      if (!options.preset) {
        throw new Error('adopt requires --preset');
      }
      const result = await runAdoptWorkflow(options, { cwd: env.cwd });
      stdout.write(`Adopted ignorekit project at ${result.projectPath}\n`);
      return { exitCode: 0 };
    }
    if (command === 'extract') {
      const subcommand = args[1];
      if (subcommand !== 'component') {
        throw new Error('extract supports only: component');
      }
      const options = parseArgs(args.slice(2));
      options.id = options._[0];
      const result = runExtractComponent(options, { cwd: env.cwd });
      stdout.write(`Created component ${result.outputPath}\n`);
      return { exitCode: 0 };
    }
    if (command === 'preset') {
      const subcommand = args[1];
      if (subcommand !== 'create') {
        throw new Error('preset supports only: create');
      }
      const options = parseArgs(args.slice(2));
      options.name = options._[0];
      options.components = collectRepeated(args.slice(2), '--component');
      const result = runPresetCreate(options, { cwd: env.cwd });
      stdout.write(`Created preset ${result.outputPath}\n`);
      return { exitCode: 0 };
    }
    parseArgs(args.slice(1));
    throw new Error(`Unknown command: ${rawCommand}`);
  } catch (error) {
    stderr.write(`ignorekit: ${error.message}\n`);
    return { exitCode: 1 };
  }
}

module.exports = { parseArgs, runCli, collectRepeated };
