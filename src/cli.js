'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('./core/json');
const { createDefinitionResolver } = require('./definitions/resolver');
const { generateGitignore } = require('./generator');
const { runInitWorkflow } = require('./workflows/init');
const { runAdoptWorkflow } = require('./workflows/adopt');
const { runExtractComponent } = require('./workflows/extract');
const { runPresetCreate } = require('./workflows/preset');

const DIST_ROOT = path.resolve(__dirname, '..');

// --- Argument parsing ---

const BOOLEAN_OPTIONS = new Set([
  'all', 'yes', 'git', 'noGit', 'dryRun', 'preview',
  'overwrite', 'overwriteConfig', 'removeCached',
  'allowNestedGit', 'apply'
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
    if (BOOLEAN_OPTIONS.has(key)) {
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

// --- Help system ---

function printGeneralHelp(stdout) {
  stdout.write(`ignorekit - composable .gitignore generator

Usage:
  ignorekit <command> [options]

Commands:
  list        List available components, presets
  generate    Generate .gitignore from a project config
  init        Initialize a new project with config and .gitignore
  adopt       Adopt an existing project into ignorekit
  extract     Extract a reusable component from an existing .gitignore
  preset      Create a new preset definition

Run 'ignorekit help <command>' for detailed usage.
`);
}

function printCommandHelp(command, stdout) {
  const helps = {
    list: `ignorekit list - List available definitions

Usage:
  ignorekit list [components|presets]

Arguments:
  target    What to list: components, presets (default: both)

Examples:
  ignorekit list
  ignorekit list components
  ignorekit list presets
`,
    generate: `ignorekit generate - Generate .gitignore from a project config

Usage:
  ignorekit generate <config> [options]

Arguments:
  config    Path to ignorekit.json

Options:
  --dist-root <path>     Root directory for shipped definitions
  --user-root <path>     User-level override directory
  --workspace-root <path> Workspace-level definition directory
  --output <path>        Output file path (default: .gitignore next to config)

The generate command is pure: it reads the config and produces a .gitignore
without any Git side effects or addons.

Examples:
  ignorekit generate ./ignorekit.json
  ignorekit generate ./ignorekit.json --output ./generated.gitignore
`,
    init: `ignorekit init - Initialize a new project

Usage:
  ignorekit init <project-path> --preset <name> [options]

Arguments:
  project-path    Directory to initialize

Options:
  --preset <name>        Preset to use (required)
  --provider <name>      Provider name: local (default) or gitignore.io
  --git                  Run git init in the project directory
  --no-git               Skip git init (default)
  --overwrite            Overwrite an existing ignorekit.json
  --dist-root <path>     Root directory for shipped definitions
  --allow-nested-git     Allow initializing a nested Git repo

Creates an ignorekit.json config and generates a .gitignore.
If --git is set, also initializes a Git repository (unless one already exists).

Examples:
  ignorekit init ./my-app --preset java-gradle --git
  ignorekit init ./web-app --preset frontend-vite --no-git
`,
    adopt: `ignorekit adopt - Adopt an existing project into ignorekit

Usage:
  ignorekit adopt <project-path> --preset <name> [options]

Arguments:
  project-path    Path to the existing project directory

Options:
  --preset <name>        Preset to use (required)
  --provider <name>      Provider name: local (default) or gitignore.io
  --apply                Overwrite .gitignore directly (default: write .gitignore.preview)
  --overwrite-config     Overwrite an existing ignorekit.json
  --remove-cached        Remove Git-tracked files that should be ignored
  --yes                  Confirm removal without prompt (use with --remove-cached)
  --dist-root <path>     Root directory for shipped definitions

By default, adopt writes a .gitignore.preview file so you can review before
applying. Use --apply to overwrite .gitignore directly.

Examples:
  ignorekit adopt ./existing-project --preset java-gradle
  ignorekit adopt ./existing-project --preset java-gradle --apply
  ignorekit adopt ./existing-project --preset java-gradle --remove-cached --yes
`,
    extract: `ignorekit extract - Extract a reusable component from .gitignore

Usage:
  ignorekit extract component <id> --from <path> [options]

Arguments:
  id          Component identifier (e.g. local/runtime)
  --from      Path to the source .gitignore file (required)

Options:
  --output-root <path>   Output directory (default: .ignorekit)

Reads an existing .gitignore and writes it as a reusable component
that can be referenced by presets or project configs.

Examples:
  ignorekit extract component local/runtime --from ./my-project/.gitignore
  ignorekit extract component local/custom --from ./.gitignore --output-root .ignorekit
`,
    preset: `ignorekit preset - Create a new preset definition

Usage:
  ignorekit preset create <name> [options]

Arguments:
  name              Preset name (e.g. java-gradle-extended)

Options:
  --base <name>           Base preset to extend
  --component <id>        Add a component (repeatable)
  --output-root <path>    Output directory (default: .ignorekit)

Examples:
  ignorekit preset create java-gradle-extended --base java-gradle --component local/runtime
  ignorekit preset create full-stack --component language/java --component language/node
`
  };

  const text = helps[command];
  if (text) {
    stdout.write(text);
  } else {
    stdout.write(`No help available for '${command}'.\n\n`);
    printGeneralHelp(stdout);
  }
}

// --- List command ---

function commandList(args, env) {
  const options = parseArgs(args);
  const target = options._[0] || 'all';
  const distRoot = options.distRoot || DIST_ROOT;
  const stdout = env.stdout || process.stdout;

  const componentsDir = path.join(distRoot, 'components');
  const presetsDir = path.join(distRoot, 'presets');

  if (target === 'all' || target === 'components') {
    if (target === 'all') stdout.write('Components:\n');
    for (const component of listDefinitions(componentsDir, '.gitignore')) {
      stdout.write(`  ${component}\n`);
    }
  }

  if (target === 'all' || target === 'presets') {
    if (target === 'all') stdout.write('\n');
    stdout.write('Presets:\n');
    for (const preset of listDefinitions(presetsDir, '.json')) {
      stdout.write(`  ${preset}\n`);
    }
  }

  if (!['all', 'components', 'presets'].includes(target)) {
    throw new Error(`Unknown list target: ${target}. Use: components, presets`);
  }
}

function listDefinitions(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return walkFiles(directory)
    .filter((file) => file.endsWith(extension))
    .map((file) => path.relative(directory, file).replace(/\\/g, '/').replace(new RegExp(`\\${extension}$`), ''))
    .sort();
}

function walkFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

// --- Generate command ---

function createResolverFromOptions(options, configPath) {
  const projectRoot = path.dirname(path.resolve(configPath));
  return createDefinitionResolver({
    distRoot: options.distRoot || DIST_ROOT,
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

// --- Command dispatch ---

async function runCli(args, env = {}) {
  const stdout = env.stdout || process.stdout;
  const stderr = env.stderr || process.stderr;
  const command = args[0] || 'help';

  try {
    // Help
    if (command === 'help' || command === '--help' || command === '-h') {
      const subcommand = args[1];
      if (subcommand) {
        printCommandHelp(subcommand, stdout);
      } else {
        printGeneralHelp(stdout);
      }
      return { exitCode: 0 };
    }

    // List
    if (command === 'list') {
      commandList(args.slice(1), { stdout, stderr, cwd: env.cwd });
      return { exitCode: 0 };
    }

    // Generate
    if (command === 'generate') {
      await commandGenerate(args.slice(1), { stdout, stderr, cwd: env.cwd });
      return { exitCode: 0 };
    }

    // Init
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

    // Adopt
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

    // Extract
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

    // Preset
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

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    stderr.write(`ignorekit: ${error.message}\n`);
    return { exitCode: 1 };
  }
}

module.exports = { parseArgs, runCli };
