'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('./core/json');
const { DIST_ROOT } = require('./core/path');
const { normalizeProjectConfig } = require('./config/project-config');
const { resolvePresetChain } = require('./definitions/resolver');
const { buildResolver, applyUserRootDefault } = require('./core/resolver-factory');
const { createAsk, createConfirm, isInteractive, runWithQuestions, readAllLines } = require('./cli/prompt');
const { version: VERSION } = require('../package.json');
const { generateGitignore } = require('./generator');
const { runInitWorkflow } = require('./workflows/init');
const { runAdoptWorkflow } = require('./workflows/adopt');
const { runComponentCreate } = require('./workflows/component');
const { runPresetCreate } = require('./workflows/preset');
const { runComponentRemove, runPresetRemove } = require('./workflows/remove');
const { promptComponentCreation, promptPresetCreation } = require('./interactive/create');
const { runExplainWorkflow } = require('./workflows/explain');
const { runAnalyzeWorkflow, analyzeGitignore, tryAnalyzeGitignore } = require('./workflows/analyze');
const { debugError } = require('./core/debug');
const { extractStreams } = require('./core/env');
const { listTrackedIgnoredFiles, removeCachedFiles } = require('./git');

// --- Argument parsing ---

const BOOLEAN_OPTIONS = new Set([
  'all', 'confirm', 'git', 'dryRun', 'preview',
  'overwrite', 'overwriteConfig', 'removeCached',
  'allowNestedGit', 'verbose', 'suggestPreset'
]);

// Repeatable options accumulate into arrays instead of overwriting.
// The key is the camelCase option name; the value is the plural property
// name on the options object (e.g. --component -> options.components).
const REPEATABLE_OPTIONS = {
  template: 'templates',
  component: 'components',
  exclude: 'exclude',
  rule: 'rules'
};

// Removed CLI flags — reject with a helpful message instead of silently
// accepting them as generic string options. Tests should use environment
// variables (IGNOREKIT_DIST_ROOT, IGNOREKIT_USER_ROOT) instead.
const REMOVED_OPTIONS = {
  distRoot: 'Use the IGNOREKIT_DIST_ROOT environment variable instead',
  userRoot: 'Use the IGNOREKIT_USER_ROOT environment variable instead',
  noGit: 'The default is no git init; just use --git when you want git init',
  yes: 'Confirmation is now the default in interactive mode; use --confirm on remove to skip the prompt in CI',
  apply: 'Adopt always writes after confirmation — the flag is no longer needed',
  generate: 'Adopt always writes after confirmation — the flag is no longer needed'
};

function parseArgs(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    // `--key=value` is shorthand for `--key value`. Most CLIs accept both, and
    // shell users frequently copy the equals form from documentation.
    let inlineValue = null;
    let body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      inlineValue = body.slice(eq + 1);
      body = body.slice(0, eq);
    }
    if (body.length === 0) {
      throw new Error(`Option ${arg} is missing a flag name.`);
    }
    const key = body.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (key in REMOVED_OPTIONS) {
      throw new Error(`Option --${body} is no longer supported. ${REMOVED_OPTIONS[key]}.`);
    }
    if (BOOLEAN_OPTIONS.has(key)) {
      // Boolean flags must not silently accept `--yes=false` style values —
      // the spec is "presence of the flag is true". Reject any inline value so
      // the user finds out immediately instead of seeing an option they did
      // not intend to flip.
      if (inlineValue !== null) {
        throw new Error(`Option ${arg} does not take a value.`);
      }
      options[key] = true;
      continue;
    }
    if (inlineValue !== null) {
      if (key in REPEATABLE_OPTIONS) {
        const prop = REPEATABLE_OPTIONS[key];
        if (!options[prop]) options[prop] = [];
        options[prop].push(inlineValue);
      } else {
        options[key] = inlineValue;
      }
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Option ${arg} requires a value.`);
    }
    if (key in REPEATABLE_OPTIONS) {
      const prop = REPEATABLE_OPTIONS[key];
      if (!options[prop]) options[prop] = [];
      options[prop].push(value);
    } else {
      options[key] = value;
    }
    index += 1;
  }
  return options;
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
  create      Create a component or preset definition
  remove      Remove a user-defined component or preset

Options:
  --version   Print version and exit
  --help      Show help (use --help <command> for details)

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

Options:
  --workspace-root <path> Team-shared definition directory

Examples:
  ignorekit list
  ignorekit list components
  ignorekit list presets
`,
    generate: `ignorekit generate - Generate .gitignore from a project config

Usage:
  ignorekit generate [config] [options]

Arguments:
  config    Path to ignorekit.json (default: ./ignorekit.json)

Options:
  --workspace-root <path> Team-shared definition directory
  --output <path>        Output file path (default: .gitignore next to config)
  --preview              Skip the "Show preview?" question, show directly
  --confirm              Skip the "Overwrite?" prompt (for CI)
  --remove-cached        Remove Git-tracked files that should be ignored
  --dry-run              Preview only, don't write or remove files

The generate command reads the config and produces a .gitignore.
When run with no arguments, it reads ./ignorekit.json in the current directory.

If --preview is not passed, generate asks whether to show the preview.
When a .gitignore already exists, generate asks for confirmation before
overwriting. Pass --confirm to skip the prompt (useful in CI).

With --remove-cached, files that are tracked by Git but now ignored by
the new .gitignore are removed from the Git index. Add --dry-run to
preview which files would be removed without actually removing them.

Examples:
  ignorekit generate
  ignorekit generate ./ignorekit.json
  ignorekit generate ./ignorekit.json --output ./generated.gitignore
  ignorekit generate --confirm --remove-cached
  ignorekit generate --remove-cached --dry-run
`,
    init: `ignorekit init - Initialize a new project

Usage:
  ignorekit init [project-path] [--preset <name>] [options]

Arguments:
  project-path    Directory to initialize (default: current directory)

Options:
  --preset <name>        Preset to use (if omitted, shows interactive picker)
  --component <id>       Add a component alongside the chosen preset (repeatable)
  --exclude <id>         Exclude a component from the chosen preset (repeatable)
  --git                  Run git init in the project directory
  --overwrite            Replace existing ignorekit.json and .gitignore
  --preview              Skip the "Show preview?" question, show directly
  --workspace-root <path> Team-shared definition directory
  --allow-nested-git     Allow initializing a nested Git repo

Creates an ignorekit.json config and generates a .gitignore.
If --preview is not passed, init asks whether to show the generated
.gitignore preview. If --preset is omitted, an interactive picker
will suggest presets based on any existing .gitignore in the project.

Examples:
  ignorekit init                          # interactive: pick preset, use current dir
  ignorekit init ./my-app --preset java-gradle --git
  ignorekit init ./web-app --preset vite
`,
    adopt: `ignorekit adopt - Adopt an existing project into ignorekit

Usage:
  ignorekit adopt [project-path] [--preset <name>] [options]

Arguments:
  project-path    Path to the existing project directory (default: current directory)

Options:
  --preset <name>        Preset to use (if omitted, shows interactive picker)
  --component <id>       Add a component alongside the chosen preset (repeatable)
  --exclude <id>         Exclude a component from the chosen preset (repeatable)
  --overwrite-config     Skip the "Overwrite config?" question, overwrite directly
  --preview              Skip the "Show preview?" question, show directly
  --confirm              Skip the "Overwrite .gitignore?" prompt (for CI)
  --remove-cached        Remove Git-tracked files that should be ignored
  --dry-run              Preview only, don't write or remove files
  --workspace-root <path> Team-shared definition directory

If --preset is omitted, analyzes any existing .gitignore and suggests
the best-matching preset interactively.

Interactive flow: analyze → pick preset → pick extras →
(overwrite-config?) → (preview?) → (overwrite .gitignore?) → write.

Examples:
  ignorekit adopt                           # fully interactive
  ignorekit adopt --preset java-gradle      # interactive with preset chosen
  ignorekit adopt ./project --preset vite
`,
    create: `ignorekit create - Create reusable definitions

Usage:
  ignorekit create component [name] [options]
  ignorekit create preset [name] [options]

With no name, create opens a guided review where you can revise each choice
before writing the final file.

Component options:
  --category <name>       Component category, for example local or framework
  --from <path>           Read rules from a .gitignore file (smart-analyzed)
  --rule <pattern>        Include one rule (repeatable; explicit, no analysis)
  --output-root <path>    Definition root (default: ~/.ignorekit)
  --overwrite             Replace an existing component
  --workspace-root <path> Team-shared definition directory

  The positional name can include a category prefix using slash syntax:
  "local/runtime" is equivalent to --category local --name runtime.
  When both the slash syntax and --category are provided, --category wins.

  When --from is used, the source .gitignore is analyzed against known
  components and only the unmatched (custom) rules are extracted. Pass
  --rule for literal rules (no analysis).

Preset options:
  --base <name>           Base preset to extend
  --component <id>        Include a component (repeatable)
  --output-root <path>    Definition root (default: ~/.ignorekit)
  --overwrite             Replace an existing preset

Examples:
  ignorekit create component runtime --category local --from ./.gitignore
  ignorekit create component local/runtime --from ./.gitignore
  ignorekit create component docker --category deployment --rule docker-compose.override.yml
  ignorekit create preset team-vite --base vite --component local/runtime
`,
    remove: `ignorekit remove - Remove a user-defined component or preset

Usage:
  ignorekit remove component <id> [options]
  ignorekit remove preset <id> [options]

Arguments:
  id         Definition ID (e.g. language/kotlin-canceled, my-preset)

Options:
  --workspace-root <path> Team-shared definition directory
  --confirm               Confirm removal without prompt (required in non-interactive mode)

  Only user-layer and workspace-layer definitions can be removed.
  Shipped (dist-layer) definitions cannot be deleted.

Examples:
  ignorekit remove component language/kotlin-canceled
  ignorekit remove preset my-old-preset --confirm
`,
    explain: `ignorekit explain - Explain what an ignorekit.json config produces

Usage:
  ignorekit explain [config] [options]

Arguments:
  config    Path to ignorekit.json (default: ./ignorekit.json)

Options:
  --verbose               Show full component content (not just summary)
  --workspace-root <path> Team-shared definition directory

Shows which components the preset brings, what each component contributes,
and what custom rules are project-specific. Like MySQL EXPLAIN for gitignore.

Examples:
  ignorekit explain
  ignorekit explain ./ignorekit.json --verbose
`,
    analyze: `ignorekit analyze - Analyze a .gitignore against known components

Usage:
  ignorekit analyze [gitignore-path] [options]

Arguments:
  gitignore-path    Path to the .gitignore file to analyze (default: ./.gitignore)

Options:
  --suggest-preset       Suggest the best-matching preset
  --workspace-root <path> Team-shared definition directory

Matches lines in the .gitignore against known components, identifies
what is covered and what is custom, and optionally suggests a preset.

Examples:
  ignorekit analyze
  ignorekit analyze ./.gitignore --suggest-preset
`
  };

  const text = helps[command];
  if (text) {
    stdout.write(text);
  } else {
    const validCommands = Object.keys(helps).join(', ');
    stdout.write(`No help available for '${command}'.\n\nValid commands: ${validCommands}\n\n`);
    printGeneralHelp(stdout);
  }
}

// --- List command ---

function commandList(args, env) {
  const options = applyUserRootDefault(parseArgs(args));
  const target = options._[0] || 'all';
  const { stdout, stderr, cwd } = extractStreams(env);

  const resolver = buildResolver({ options, env });

  if (target === 'all' || target === 'components') {
    if (target === 'all') stdout.write('Components:\n');
    for (const component of resolver.listComponents()) {
      stdout.write(`  ${component}\n`);
    }
  }

  if (target === 'all' || target === 'presets') {
    if (target === 'all') stdout.write('\n');
    stdout.write('Presets:\n');
    for (const preset of resolver.listPresets()) {
      try {
        const chain = resolvePresetChain(resolver, preset);
        if (chain.length > 1) {
          const bases = chain.slice(0, -1).join(' → ');
          stdout.write(`  ${preset} (extends ${bases})\n`);
        } else {
          stdout.write(`  ${preset}\n`);
        }
      } catch (err) {
        debugError(err, 'list.preset-chain', { stdout, stderr, cwd });
        stdout.write(`  ${preset}\n`);
      }
    }
  }

  if (!['all', 'components', 'presets'].includes(target)) {
    throw new Error(`Unknown list target: ${target}. Use: components, presets`);
  }
}

// --- Generate command ---

function createResolverFromOptions(options, configPath, env) {
  const projectRoot = path.dirname(path.resolve(configPath));
  return buildResolver({ options, env, projectDirHint: projectRoot });
}

async function commandGenerate(args, env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  const options = applyUserRootDefault(parseArgs(args));
  // Default to ./ignorekit.json in current directory when no config path
  // is provided — the most common use case after `ignorekit adopt`.
  const configPath = options._[0] || 'ignorekit.json';
  const absoluteConfigPath = path.resolve(cwd, configPath);
  const rawConfig = readJson(absoluteConfigPath);
  let config;
  try {
    config = normalizeProjectConfig(rawConfig);
  } catch (err) {
    throw new Error(`Invalid config ${absoluteConfigPath}: ${err.message}`);
  }
  const resolver = createResolverFromOptions(options, absoluteConfigPath, env);
  const content = await generateGitignore({ config, resolver, env });
  const outputPath = path.resolve(path.dirname(absoluteConfigPath), options.output || '.gitignore');

  // Preview: ask instead of auto-showing. When --preview is passed, show the
  // preview directly (the flag is the explicit answer). When the flag is NOT
  // passed, ask interactively. In non-interactive mode (no env.ask), skip the
  // preview entirely — CI doesn't need a preview unless explicitly requested.
  if (options.preview) {
    stdout.write(`\n--- Preview (.gitignore) ---\n`);
    stdout.write(content);
    stdout.write(`--- End preview ---\n\n`);
  } else if (env.ask) {
    const showPreview = await env.ask('Show preview of generated .gitignore? [Y/n]: ');
    if (!showPreview || showPreview.trim().toLowerCase() !== 'n') {
      stdout.write(`\n--- Preview (.gitignore) ---\n`);
      stdout.write(content);
      stdout.write(`--- End preview ---\n\n`);
    } else {
      stdout.write('Preview skipped.\n');
    }
  }

  // Confirm before overwriting an existing .gitignore. Only ask when a
  // .gitignore already exists — creating a new file never needs confirmation.
  // --confirm skips the prompt (for CI). Non-interactive environments (no
  // env.confirm) proceed without asking.
  if (fs.existsSync(outputPath) && env.confirm && !options.confirm) {
    const proceed = await env.confirm('Overwrite existing .gitignore? [Y/n]: ');
    if (!proceed) {
      stdout.write('Cancelled — no files written.\n');
      return { exitCode: 1 };
    }
  }

  fs.writeFileSync(outputPath, content, 'utf8');
  stdout.write(`Generated ${outputPath}\n`);

  // Handle cached file removal. --remove-cached is an explicit opt-in, so it
  // removes for real. Combine with --dry-run to preview without removing.
  if (options.removeCached) {
    const projectPath = path.dirname(absoluteConfigPath);
    const files = listTrackedIgnoredFiles(projectPath);
    const cachedRemoval = removeCachedFiles(projectPath, files, { dryRun: options.dryRun });
    if (cachedRemoval.action === 'dry-run' && cachedRemoval.files.length > 0) {
      stdout.write('Files that would be removed from Git index:\n');
      for (const file of cachedRemoval.files) {
        stdout.write(`  ${file}\n`);
      }
    } else if (cachedRemoval.action === 'removed') {
      stdout.write(`Removed ${cachedRemoval.files.length} file(s) from Git index\n`);
    }
  }
}

// --- Interactive preset picker ---

/**
 * Interactive preset picker. When --preset is missing:
 * 1. If there's a .gitignore, analyze it and suggest the best match
 * 2. Show a numbered list of all presets for the user to pick
 * 3. Return the chosen preset name, or null if cancelled
 */
async function pickPresetInteractive(options, env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  const stdin = env.stdin || process.stdin;
  const distRoot = options.distRoot || process.env.IGNOREKIT_DIST_ROOT || DIST_ROOT;

  // Try to auto-detect from existing .gitignore
  let suggestion = null;
  const projectPath = path.resolve(cwd, options.projectPath || '.');
  const gitignorePath = path.join(projectPath, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    stdout.write('\nFound .gitignore — analyzing for preset suggestions...\n\n');
    const analysis = tryAnalyzeGitignore({
      gitignorePath,
      distRoot,
      userRoot: options.userRoot,
      workspaceRoot: options.workspaceRoot,
      projectPath
    }, { stdout, stderr, cwd }, 'preset-picker.analyze');

    if (analysis && analysis.bestPreset && analysis.bestPreset.score > 0) {
      suggestion = analysis.bestPreset.id;
      const matchInfo = `${analysis.bestPreset.fullCount} of ${analysis.bestPreset.componentCount} components matched`;
      stdout.write(`💡 Best match: ${suggestion} (${matchInfo})\n\n`);
    } else if (analysis === null) {
      // Surface the failure rather than silently falling back. Most common
      // cause is a .gitignore > 1 MiB (refused by analyzeGitignore), which
      // otherwise looks like "no suggestion available" and confuses users.
      stderr.write(`Picking from the full preset list instead.\n`);
    }
  }

  // List all presets for the user to pick
  const resolver = buildResolver({ options, env, projectDirHint: projectPath });
  const presetIds = resolver.listPresets();
  if (presetIds.length === 0) {
    stdout.write('No presets available.\n');
    return null;
  }

  // Quick-access options: generic (safe default) and blank (no preset).
  // Each shortcut is only advertised when the preset is actually present in the
  // active resolver; otherwise the prompt text and the 'g'/'b' shortcut handler
  // would drift apart (the prompt would offer a shortcut the handler then
  // refuses). Compute availability once and reuse it below.
  const hasGeneric = presetIds.includes('generic');
  const hasBlank = presetIds.includes('blank');
  if (hasGeneric || hasBlank) {
    stdout.write('Quick options:\n');
    if (hasGeneric) {
      stdout.write('  g. generic (safe default — platform, editor, secrets, logs)\n');
    }
    if (hasBlank) {
      stdout.write('  b. blank (no components — build from scratch)\n');
    }
    stdout.write('\n');
  }

  stdout.write('Available presets:\n');
  // Put the suggested preset at the top of the list so it's immediately visible
  const sortedPresets = suggestion
    ? [suggestion, ...presetIds.filter(p => p !== suggestion)]
    : presetIds;
  for (let i = 0; i < sortedPresets.length; i++) {
    const marker = sortedPresets[i] === suggestion ? ' ← suggested' : '';
    stdout.write(`  ${i + 1}. ${sortedPresets[i]}${marker}\n`);
  }
  stdout.write('\n');

  // Determine the safe default. Using `presetIds[0]` as a fallback is unsafe —
  // it just picks whatever happens to be alphabetically first (often 'blank'
  // or 'angular' depending on what's been added at the user layer). When there
  // is no suggestion and no 'generic' preset available, refuse to default and
  // require the user to pick explicitly.
  const safeDefault = suggestion || (hasGeneric ? 'generic' : null);
  const defaultLabel = safeDefault || '(choose one)';
  // Read user input. Route through runWithQuestions so prompt reading uses a
  // single readline lifecycle shared with the create flow.
  const answer = await runWithQuestions(
    { stdin, stdout, ask: env.ask, stderr },
    ask => ask(`Pick a preset (name, number, or g/b) [${defaultLabel}]: `)
  );

  if (answer === null) {
    // runWithQuestions gave up under non-interactive mode. When a safe default
    // exists (suggestion or 'generic'), use it so CI pipelines can proceed
    // without --preset when a reasonable default is available.
    if (safeDefault) return safeDefault;
    stderr.write('No default preset available. Pass --preset <name> explicitly.\n');
    return null;
  }

  if (answer.trim() === '') {
    if (safeDefault) return safeDefault;
    stdout.write('No default preset available — pick one by name, number, or g/b.\n');
    return null;
  }

  const v = answer.trim().toLowerCase();
  if (v === 'g' || v === 'generic') {
    if (hasGeneric) return 'generic';
    stdout.write(`'generic' preset is not available.\n`);
    return null;
  }
  if (v === 'b' || v === 'blank') {
    if (hasBlank) return 'blank';
    stdout.write(`'blank' preset is not available.\n`);
    return null;
  }

  const num = parseInt(v, 10);
  if (Number.isInteger(num) && num >= 1 && num <= sortedPresets.length) return sortedPresets[num - 1];

  // Try matching by name (case-sensitive first, then case-insensitive)
  const trimmed = answer.trim();
  if (presetIds.includes(trimmed)) return trimmed;
  const ciMatch = presetIds.find(p => p.toLowerCase() === trimmed.toLowerCase());
  if (ciMatch) return ciMatch;

  stdout.write(`Invalid selection: ${trimmed}\n`);
  return null;
}

/**
 * Build the env passed to write workflows (adopt, init, generate, create).
 * Adds confirm() and ask() callbacks for interactive prompts.
 * Non-interactive environments (CI, piped stdin) naturally get null callbacks,
 * so workflows skip prompts automatically — no --yes flag needed.
 */
function buildCreateEnv(env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  const result = { stdout, stderr, cwd };

  if (env.stdin) result.stdin = env.stdin;

  // When env.ask is provided by tests, pass it through so test-driven prompts
  // work. When env.ask is absent, create an ask function from readline for
  // the workflow's interactive questions (overwrite-config, preview).
  if (env.ask) {
    result.ask = env.ask;
  } else {
    const ask = createAsk(env);
    if (ask) result.ask = ask;
  }

  if (env.confirm) { result.confirm = env.confirm; return result; }

  const confirm = createConfirm(env);
  if (confirm) result.confirm = confirm;
  return result;
}

/**
 * Build the env passed to pickPresetInteractive. Centralizes the env
 * construction so that cwd, stdin, and ask are consistently included
 * across both the init and adopt command paths.
 */
function buildPickerEnv(env) {
  const { stdout, stderr, cwd } = extractStreams(env);
  return { stdout, stderr, cwd, stdin: env.stdin, ask: env.ask };
}

// --- Command dispatch ---
// The dispatch is a flat if/else chain rather than a command-registry pattern.
// A registry would reduce line count but adds indirection that makes the
// control flow harder to follow for a CLI with ~10 commands. Revisit if the
// command count grows significantly or if shared middleware (e.g. global
// option validation) becomes repetitive.

async function runCli(args, env = {}) {
  const { stdout, stderr, cwd } = extractStreams(env);

  // Temporarily set environment variables (used by tests to redirect
  // IGNOREKIT_DIST_ROOT / IGNOREKIT_USER_ROOT to temp directories).
  // These are restored after the command completes.
  const envVars = env.envVars;
  const saved = {};
  if (envVars) {
    for (const key of Object.keys(envVars)) {
      saved[key] = process.env[key];
      if (envVars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envVars[key];
      }
    }
  }

  const command = args[0] || 'help';

  try {
    // Version
    if (command === '--version' || command === '-v') {
      stdout.write(`ignorekit v${VERSION}\n`);
      return { exitCode: 0 };
    }

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
      commandList(args.slice(1), { stdout, stderr, cwd });
      return { exitCode: 0 };
    }

    // Generate
    if (command === 'generate') {
      const options = applyUserRootDefault(parseArgs(args.slice(1)));
      // Route through buildCreateEnv so TTY/CI detection honors the same
      // rules as init, adopt, and create. The generate command now has a
      // preview + confirm gate matching the other write-to-disk commands.
      const generateEnv = buildCreateEnv({ stdout, stderr, cwd, stdin: env.stdin, ask: env.ask });
      const result = await commandGenerate(args.slice(1), generateEnv);
      // commandGenerate returns { exitCode: 1 } when the user declines the
      // confirm prompt; undefined/void when it succeeds.
      return { exitCode: result && result.exitCode ? result.exitCode : 0 };
    }

    // Explain
    if (command === 'explain') {
      const options = applyUserRootDefault(parseArgs(args.slice(1)));
      options.configPath = options._[0] || 'ignorekit.json';
      runExplainWorkflow(options, { stdout, stderr, cwd });
      return { exitCode: 0 };
    }

    // Analyze
    if (command === 'analyze') {
      const options = applyUserRootDefault(parseArgs(args.slice(1)));
      options.gitignorePath = options._[0] || '.gitignore';
      // The cwd is the project root for signal detection. When the .gitignore
      // is in a subdirectory, signal detection must still scan the project root
      // (where package.json, build.gradle, etc. live), not the subdirectory.
      if (!options.projectPath) {
        options.projectPath = cwd;
      }
      runAnalyzeWorkflow(options, { stdout, stderr, cwd });
      return { exitCode: 0 };
    }

    // Init
    if (command === 'init') {
      const options = applyUserRootDefault(parseArgs(args.slice(1)));
      options.projectPath = options._[0] || '.';
      if (!options.preset) {
        const picked = await pickPresetInteractive(options, buildPickerEnv(env));
        if (!picked) return { exitCode: 1 };
        options.preset = picked;
      }
      options.git = Boolean(options.git);
      // Repeatable options (templates, components, exclude) are now accumulated
      // by parseArgs into arrays. Default to empty arrays when none were given.
      options.templates = options.templates || [];
      options.components = options.components || [];
      options.exclude = options.exclude || [];
      // Route through buildCreateEnv so TTY/CI detection honors the same
      // rules as `adopt` and `create`. Previously init had no confirm gate.
      const initEnv = buildCreateEnv({ stdout, stderr, cwd, stdin: env.stdin, ask: env.ask });
      const result = await runInitWorkflow(options, initEnv);
      if (result.configPath === null) {
        // User declined the confirm — no files written.
        return { exitCode: 1 };
      }
      stdout.write(`Initialized ignorekit project at ${result.projectPath}\n`);
      if (result.git && result.git.action === 'initialized') {
        stdout.write('Git: initialized\n');
      } else if (result.git && result.git.action === 'skipped') {
        stdout.write('Git: already present\n');
      }
      return { exitCode: 0 };
    }

    // Adopt
    if (command === 'adopt') {
      const options = applyUserRootDefault(parseArgs(args.slice(1)));
      options.projectPath = options._[0] || '.';
      if (!options.preset) {
        const picked = await pickPresetInteractive(options, buildPickerEnv(env));
        if (!picked) return { exitCode: 1 };
        options.preset = picked;
      }
      options.templates = options.templates || [];
      options.components = options.components || [];
      options.exclude = options.exclude || [];
      // Route through buildCreateEnv so TTY/CI detection honors the same
      // rules as `create`.
      const adoptEnv = buildCreateEnv({ stdout, stderr, cwd, stdin: env.stdin, ask: env.ask });
      const result = await runAdoptWorkflow(options, adoptEnv);
      if (result.configPath === null) {
        // user cancelled or declined overwrite
        return { exitCode: 1 };
      }
      stdout.write(`Adopted ignorekit project at ${result.projectPath}\n`);
      return { exitCode: 0 };
    }

    // Create
    if (command === 'create') {
      const subcommand = args[1];
      let options = applyUserRootDefault(parseArgs(args.slice(2)));
      // Route through buildCreateEnv with the same explicit env construction
      // as init and adopt, so the create command gets a consistent env shape
      // (stdout, stderr, cwd, stdin, ask) rather than the raw env object which
      // may carry extra properties or miss expected ones.
      const createEnv = buildCreateEnv({ stdout, stderr, cwd, stdin: env.stdin, ask: env.ask });
      if (subcommand === 'component') {
        options.name = options._[0];
        options.rules = options.rules || [];
        // Accept category/name syntax in the positional argument. When the
        // name contains a slash, split it into category and name -- but only
        // if the prefix before the slash looks like a valid category (no path
        // traversal like ".."). If the prefix is not a valid segment, the
        // whole name is left intact so assertSegment in component.js rejects
        // it with a clear error. If --category was also provided, the
        // explicit flag wins (the user was deliberate), but the slash prefix
        // is still stripped from the name so assertSegment does not reject it.
        if (options.name && options.name.includes('/')) {
          const slashIndex = options.name.indexOf('/');
          const prefix = options.name.slice(0, slashIndex);
          const suffix = options.name.slice(slashIndex + 1);
          // A valid category segment must not be empty, must not contain
          // path traversal, and must not contain additional slashes.
          const validPrefix = prefix.length > 0 && prefix !== '..' && !prefix.includes('/');
          if (validPrefix) {
            if (!options.category) {
              options.category = prefix;
            }
            options.name = suffix;
          }
          // If the prefix is not a valid category (e.g. "../escape"), leave
          // options.name unchanged -- assertSegment will reject the slash.
        }
        if (options.name && !options.category) {
          throw new Error('--category is required when the component name does not include a category prefix (e.g. "local/runtime")');
        }
        if (!options.name) {
          // Use the same env construction for the interactive path as for the
          // write path (createEnv), so the create command has a consistent env
          // shape throughout. The ask callback from runWithQuestions overrides
          // createEnv.ask so that readline-driven prompts work correctly with
          // both env.ask and piped stdin.
          const interactiveEnv = { stdin: env.stdin, stdout, stderr, cwd, ask: env.ask };
          const draft = await runWithQuestions(interactiveEnv, ask => promptComponentCreation(options, { ...createEnv, ask }));
          if (!draft) return { exitCode: 1 };
          options = { ...options, ...draft };
        }
        const result = await runComponentCreate(options, createEnv);
        return { exitCode: result.outputPath ? 0 : 1 };
      }
      if (subcommand === 'preset') {
        options.name = options._[0];
        options.components = options.components || [];
        if (!options.name) {
          const interactiveEnv = { stdin: env.stdin, stdout, stderr, cwd, ask: env.ask };
          const draft = await runWithQuestions(interactiveEnv, ask => promptPresetCreation(options, { ...createEnv, ask }));
          if (!draft) return { exitCode: 1 };
          options = { ...options, ...draft };
        }
        const result = await runPresetCreate(options, createEnv);
        return { exitCode: result.outputPath ? 0 : 1 };
      }
      throw new Error('create supports: component, preset');
    }

    // Remove
    if (command === 'remove') {
      const subcommand = args[1];
      const options = applyUserRootDefault(parseArgs(args.slice(2)));
      const removeEnv = buildCreateEnv({ stdout, stderr, cwd, stdin: env.stdin, ask: env.ask });
      if (subcommand === 'component') {
        options.id = options._[0];
        if (!options.id) throw new Error('Component ID is required (e.g. language/kotlin-canceled)');
        const result = await runComponentRemove(options, removeEnv);
        return { exitCode: result.removed ? 0 : 1 };
      }
      if (subcommand === 'preset') {
        options.id = options._[0];
        if (!options.id) throw new Error('Preset ID is required (e.g. my-custom-preset)');
        const result = await runPresetRemove(options, removeEnv);
        return { exitCode: result.removed ? 0 : 1 };
      }
      throw new Error('remove supports: component, preset');
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    stderr.write(`ignorekit: ${error.message}\n`);
    return { exitCode: 1 };
  } finally {
    // Restore environment variables that were temporarily set for this call.
    if (envVars) {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
    }
  }
}

module.exports = { parseArgs, runCli, pickPresetInteractive, runWithQuestions };
