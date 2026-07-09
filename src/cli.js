'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('./core/json');
const { listDefinitions } = require('./core/fs');
const { DIST_ROOT } = require('./core/path');
const { normalizeProjectConfig } = require('./config/project-config');
const { createDefinitionResolver } = require('./definitions/resolver');
const { generateGitignore } = require('./generator');
const { runInitWorkflow } = require('./workflows/init');
const { runAdoptWorkflow } = require('./workflows/adopt');
const { runExtractComponent } = require('./workflows/extract');
const { runPresetCreate } = require('./workflows/preset');
const { runExplainWorkflow } = require('./workflows/explain');
const { runAnalyzeWorkflow, analyzeGitignore } = require('./workflows/analyze');

// --- Argument parsing ---

const BOOLEAN_OPTIONS = new Set([
  'all', 'yes', 'git', 'noGit', 'dryRun', 'preview',
  'overwrite', 'overwriteConfig', 'removeCached',
  'allowNestedGit', 'apply', 'verbose', 'suggestPreset', 'full'
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
  explain     Explain what an ignorekit.json config produces
  analyze     Analyze a .gitignore against known components
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
  ignorekit init [project-path] [--preset <name>] [options]

Arguments:
  project-path    Directory to initialize (default: current directory)

Options:
  --preset <name>        Preset to use (if omitted, shows interactive picker)
  --provider <name>      Provider name: local (default) or gitignore.io
  --git                  Run git init in the project directory
  --no-git               Skip git init (default)
  --overwrite            Overwrite an existing ignorekit.json
  --dist-root <path>     Root directory for shipped definitions
  --allow-nested-git     Allow initializing a nested Git repo

Creates an ignorekit.json config and generates a .gitignore.
If --preset is omitted, an interactive picker will suggest presets
based on any existing .gitignore in the project.

Examples:
  ignorekit init                          # interactive: pick preset, use current dir
  ignorekit init ./my-app --preset java-gradle --git
  ignorekit init ./web-app --preset frontend-vite --no-git
`,
    adopt: `ignorekit adopt - Adopt an existing project into ignorekit

Usage:
  ignorekit adopt [project-path] [--preset <name>] [options]

Arguments:
  project-path    Path to the existing project directory (default: current directory)

Options:
  --preset <name>        Preset to use (if omitted, shows interactive picker)
  --provider <name>      Provider name: local (default) or gitignore.io
  --apply                Overwrite .gitignore directly (default: write .gitignore.preview)
  --overwrite-config     Overwrite an existing ignorekit.json
  --remove-cached        Remove Git-tracked files that should be ignored
  --yes                  Confirm removal without prompt (use with --remove-cached)
  --dist-root <path>     Root directory for shipped definitions

If --preset is omitted, analyzes any existing .gitignore and suggests
the best-matching preset interactively.

By default, adopt writes a .gitignore.preview file so you can review before
applying. Use --apply to overwrite .gitignore directly.

Examples:
  ignorekit adopt                           # interactive: analyze, pick preset
  ignorekit adopt --preset java-gradle      # use current directory with this preset
  ignorekit adopt ./project --preset frontend-vite --apply
`,
    extract: `ignorekit extract - Extract a reusable component from .gitignore

Usage:
  ignorekit extract component <id> --from <path> [options]

Arguments:
  id          Component identifier (e.g. local/runtime)
  --from      Path to the source .gitignore file (required)

Options:
  --full                  Extract entire .gitignore without analysis (legacy mode)
  --output-root <path>    Output directory (default: .ignorekit)
  --dist-root <path>      Root directory for shipped definitions
  --user-root <path>      User-level override directory
  --workspace-root <path> Workspace-level definition directory

By default, extract first analyzes the .gitignore against known components,
then extracts only the unmatched (custom) rules as a new component.
Use --full to skip analysis and extract the entire file.

Examples:
  ignorekit extract component local/runtime --from ./my-project/.gitignore
  ignorekit extract component local/custom --from ./.gitignore --full
`,
    explain: `ignorekit explain - Explain what an ignorekit.json config produces

Usage:
  ignorekit explain <config> [options]

Arguments:
  config    Path to ignorekit.json

Options:
  --verbose               Show full component content (not just summary)
  --dist-root <path>      Root directory for shipped definitions
  --user-root <path>      User-level override directory
  --workspace-root <path> Workspace-level definition directory

Shows which components the preset brings, what each component contributes,
and what custom rules are project-specific. Like MySQL EXPLAIN for gitignore.

Examples:
  ignorekit explain ./ignorekit.json
  ignorekit explain ./ignorekit.json --verbose
`,
    analyze: `ignorekit analyze - Analyze a .gitignore against known components

Usage:
  ignorekit analyze <gitignore-path> [options]

Arguments:
  gitignore-path    Path to the .gitignore file to analyze

Options:
  --suggest-preset       Suggest the best-matching preset
  --dist-root <path>    Root directory for shipped definitions
  --user-root <path>    User-level override directory
  --workspace-root <path> Workspace-level definition directory

Matches lines in the .gitignore against known components, identifies
what is covered and what is custom, and optionally suggests a preset.

Examples:
  ignorekit analyze ./.gitignore
  ignorekit analyze ./.gitignore --suggest-preset
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
  const rawConfig = readJson(absoluteConfigPath);
  let config;
  try {
    config = normalizeProjectConfig(rawConfig);
  } catch (err) {
    throw new Error(`Invalid config ${absoluteConfigPath}: ${err.message}`);
  }
  const resolver = createResolverFromOptions(options, absoluteConfigPath);
  const content = await generateGitignore({ config, resolver });
  const outputPath = path.resolve(path.dirname(absoluteConfigPath), options.output || '.gitignore');
  fs.writeFileSync(outputPath, content, 'utf8');
  env.stdout.write(`Generated ${outputPath}\n`);
}

// --- Interactive preset picker ---

const readline = require('readline');

/**
 * Interactive preset picker. When --preset is missing:
 * 1. If there's a .gitignore, analyze it and suggest the best match
 * 2. Show a numbered list of all presets for the user to pick
 * 3. Return the chosen preset name, or null if cancelled
 */
async function pickPresetInteractive(options, env) {
  const stdout = env.stdout || process.stdout;
  const stdin = env.stdin || process.stdin;
  const distRoot = options.distRoot || DIST_ROOT;

  // Try to auto-detect from existing .gitignore
  let suggestion = null;
  const projectPath = path.resolve(env.cwd || process.cwd(), options.projectPath || '.');
  const gitignorePath = path.join(projectPath, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    stdout.write('\nFound .gitignore — analyzing for preset suggestions...\n\n');
    try {
      const analysis = analyzeGitignore({
        gitignorePath,
        distRoot,
        userRoot: options.userRoot,
        workspaceRoot: options.workspaceRoot
      });

      if (analysis.bestPreset && analysis.bestPreset.score > 0) {
        suggestion = analysis.bestPreset.id;
        const matchInfo = `${analysis.bestPreset.fullCount}/${analysis.bestPreset.componentCount} components matched`;
        stdout.write(`💡 Best match: ${suggestion} (${matchInfo})\n\n`);
      }
    } catch {
      // Analysis failed — fall through to manual selection
    }
  }

  // List all presets for the user to pick
  const presetsDir = path.join(distRoot, 'presets');
  let presetIds;
  try {
    presetIds = listDefinitions(presetsDir, '.json');
  } catch {
    stdout.write('No presets available.\n');
    return null;
  }

  stdout.write('Available presets:\n');
  for (let i = 0; i < presetIds.length; i++) {
    const marker = presetIds[i] === suggestion ? ' ← suggested' : '';
    stdout.write(`  ${i + 1}. ${presetIds[i]}${marker}\n`);
  }
  stdout.write(`  0. blank (no components — build from scratch)\n`);
  stdout.write('\n');

  // Read user input
  const answer = await readLine(stdin, stdout, suggestion
    ? `Pick a preset (1-${presetIds.length}, 0=blank) [${presetIds.indexOf(suggestion) + 1}]: `
    : `Pick a preset (1-${presetIds.length}, 0=blank): `
  );

  if (answer.trim() === '') {
    // Default to suggestion if available
    if (suggestion) return suggestion;
    stdout.write('No preset selected.\n');
    return null;
  }

  const num = parseInt(answer.trim(), 10);
  if (num === 0) return 'blank';
  if (num >= 1 && num <= presetIds.length) return presetIds[num - 1];

  // Try matching by name
  if (presetIds.includes(answer.trim())) return answer.trim();

  stdout.write(`Invalid selection: ${answer.trim()}\n`);
  return null;
}

function readLine(stdin, stdout, prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// --- Command dispatch ---
// review #13 by-design: runCli uses a sequential if/else dispatch block.
// Future refactor target: extract to a command registry pattern for extensibility.

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

    // Explain
    if (command === 'explain') {
      const options = parseArgs(args.slice(1));
      options.configPath = options._[0];
      if (!options.configPath) {
        throw new Error('explain requires a config path');
      }
      runExplainWorkflow(options, { stdout, stderr, cwd: env.cwd });
      return { exitCode: 0 };
    }

    // Analyze
    if (command === 'analyze') {
      const options = parseArgs(args.slice(1));
      options.gitignorePath = options._[0];
      if (!options.gitignorePath) {
        throw new Error('analyze requires a .gitignore path');
      }
      runAnalyzeWorkflow(options, { stdout, stderr, cwd: env.cwd });
      return { exitCode: 0 };
    }

    // Init
    if (command === 'init') {
      const options = parseArgs(args.slice(1));
      options.projectPath = options._[0] || '.';
      if (!options.preset) {
        const picked = await pickPresetInteractive(options, { stdout, stderr, stdin: env.stdin });
        if (!picked) return { exitCode: 1 };
        options.preset = picked;
      }
      options.git = Boolean(options.git);
      if (options.noGit) {
        options.git = false;
      }
      options.templates = collectRepeated(args.slice(1), '--template');
      const result = await runInitWorkflow(options, { cwd: env.cwd });
      stdout.write(`Initialized ignorekit project at ${result.projectPath}\n`);
      return { exitCode: 0 };
    }

    // Adopt
    if (command === 'adopt') {
      const options = parseArgs(args.slice(1));
      options.projectPath = options._[0] || '.';
      if (!options.preset) {
        const picked = await pickPresetInteractive(options, { stdout, stderr, stdin: env.stdin });
        if (!picked) return { exitCode: 1 };
        options.preset = picked;
      }
      options.templates = collectRepeated(args.slice(1), '--template');
      const result = await runAdoptWorkflow(options, { stdout, stderr, cwd: env.cwd });
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
      const result = runExtractComponent(options, { stdout, stderr, cwd: env.cwd });
      if (result.outputPath) {
        stdout.write(`Created component ${result.outputPath}\n`);
      }
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
