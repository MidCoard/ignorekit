'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('./core/json');
const { DIST_ROOT } = require('./core/path');
const { normalizeProjectConfig } = require('./config/project-config');
const { resolvePresetChain } = require('./definitions/resolver');
const { buildResolver, applyUserRootDefault } = require('./core/resolver-factory');
const { createConfirm, isInteractive, runWithQuestions, readAllLines } = require('./cli/prompt');
const { generateGitignore } = require('./generator');
const { runInitWorkflow } = require('./workflows/init');
const { runAdoptWorkflow } = require('./workflows/adopt');
const { runComponentCreate } = require('./workflows/component');
const { runPresetCreate } = require('./workflows/preset');
const { promptComponentCreation, promptPresetCreation } = require('./interactive/create');
const { runExplainWorkflow } = require('./workflows/explain');
const { runAnalyzeWorkflow, analyzeGitignore } = require('./workflows/analyze');
const { debugError } = require('./core/debug');

// --- Argument parsing ---

const BOOLEAN_OPTIONS = new Set([
  'all', 'yes', 'git', 'noGit', 'dryRun', 'preview',
  'overwrite', 'overwriteConfig', 'removeCached',
  'allowNestedGit', 'apply', 'verbose', 'suggestPreset'
]);

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
      options[key] = inlineValue;
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

/**
 * Walk the raw argv once and collect every value supplied for `optionName`,
 * accepting both `--flag value` (consumes the next token) and `--flag=value`
 * (slices the suffix). Returns values in argument order so repeated use of
 * `--component foo --component bar` and `--component=foo --component=bar`
 * produce the same result. Empty-looking values are preserved so a deliberate
 * `--output-root ""` is not silently dropped.
 */
function collectRepeated(args, optionName) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === optionName && index + 1 < args.length) {
      values.push(args[index + 1]);
      index += 1;
    } else if (arg.startsWith(optionName + '=')) {
      values.push(arg.slice(optionName.length + 1));
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
  create      Create a component or preset definition

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
  --user-root <path>      User definition directory (default: ~/.ignorekit)
  --workspace-root <path> Workspace definition directory

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
  --component <id>       Add a component alongside the chosen preset (repeatable)
  --exclude <id>         Exclude a component from the chosen preset (repeatable)
  --template <name>      Add a gitignore.io template (repeatable, requires --provider gitignore.io)
  --provider <name>      Provider name: local (default) or gitignore.io

  The gitignore.io provider fetches templates from an external service. The
  generated .gitignore is checked for negation patterns (lines starting with
  !) and patterns matching common secret filenames; warnings are printed when
  found. Review external content before committing.

  --git                  Run git init in the project directory
  --no-git               Skip git init (default)
  --overwrite            Replace existing ignorekit.json and .gitignore
  --yes                  Skip the confirmation prompt before writing
  --dist-root <path>     Root directory for shipped definitions
  --user-root <path>     User-level definition directory
  --workspace-root <path> Workspace-level definition directory
  --allow-nested-git     Allow initializing a nested Git repo

Creates an ignorekit.json config and generates a .gitignore.
A preview is shown before writing; use --yes to skip the prompt.
If --preset is omitted, an interactive picker will suggest presets
based on any existing .gitignore in the project.

Examples:
  ignorekit init                          # interactive: pick preset, use current dir
  ignorekit init ./my-app --preset java-gradle --git
  ignorekit init ./web-app --preset vite --no-git
  ignorekit init --preset generic --yes   # non-interactive / CI
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
  --template <name>      Add a gitignore.io template (repeatable, requires --provider gitignore.io)
  --provider <name>      Provider name: local (default) or gitignore.io

  The gitignore.io provider fetches templates from an external service. The
  generated .gitignore is checked for negation patterns (lines starting with
  !) and patterns matching common secret filenames; warnings are printed when
  found. Review external content before committing.

  --apply                Write .gitignore and ignorekit.json (without this, preview only)
  --overwrite-config     Overwrite an existing ignorekit.json
  --remove-cached        Remove Git-tracked files that should be ignored
  --yes                  Skip confirmation prompts (use with --apply and/or --remove-cached)
  --dist-root <path>     Root directory for shipped definitions
  --user-root <path>     User-level definition directory
  --workspace-root <path> Workspace-level definition directory

If --preset is omitted, analyzes any existing .gitignore and suggests
the best-matching preset interactively.

Without --apply, adopt shows a preview of the generated .gitignore without
writing any files. With --apply, it writes .gitignore and ignorekit.json.
If a .gitignore already exists, a backup is saved as .gitignore.bak before
overwriting. --remove-cached requires --apply as a safety guard.

Examples:
  ignorekit adopt                           # interactive: analyze, pick preset, preview
  ignorekit adopt --preset java-gradle      # preview only
  ignorekit adopt --preset java-gradle --apply  # write files
  ignorekit adopt ./project --preset vite --apply
  ignorekit adopt --preset generic --apply --yes  # non-interactive / CI
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
  --yes                   Skip the confirmation prompt before writing
  --dist-root <path>      Root directory for shipped definitions (for analysis)
  --user-root <path>      User-level override directory (for analysis)
  --workspace-root <path> Workspace-level definition directory (for analysis)

  When --from is used, the source .gitignore is analyzed against known
  components and only the unmatched (custom) rules are extracted. Pass
  --rule for literal rules (no analysis).

  Before writing, a preview is shown and you are asked to confirm.
  Use --yes to skip the prompt in scripts.

Preset options:
  --base <name>           Base preset to extend
  --component <id>        Include a component (repeatable)
  --output-root <path>    Definition root (default: ~/.ignorekit)
  --overwrite             Replace an existing preset
  --yes                   Skip the confirmation prompt before writing

  Before writing, a preview is shown and you are asked to confirm.

Examples:
  ignorekit create component runtime --category local --from ./.gitignore
  ignorekit create component runtime --category local --from ./.gitignore --yes
  ignorekit create component docker --category deployment --rule docker-compose.override.yml
  ignorekit create preset team-vite --base vite --component local/runtime
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
  const options = applyUserRootDefault(parseArgs(args));
  const target = options._[0] || 'all';
  const stdout = env.stdout || process.stdout;

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
        debugError(err, 'list.preset-chain', { stderr });
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
  const options = applyUserRootDefault(parseArgs(args));
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
  const resolver = createResolverFromOptions(options, absoluteConfigPath, env);
  const content = await generateGitignore({ config, resolver, env });
  const outputPath = path.resolve(path.dirname(absoluteConfigPath), options.output || '.gitignore');
  fs.writeFileSync(outputPath, content, 'utf8');
  env.stdout.write(`Generated ${outputPath}\n`);
}

// --- Interactive preset picker ---

/**
 * Interactive preset picker. When --preset is missing:
 * 1. If there's a .gitignore, analyze it and suggest the best match
 * 2. Show a numbered list of all presets for the user to pick
 * 3. Return the chosen preset name, or null if cancelled
 */
async function pickPresetInteractive(options, env) {
  const stdout = env.stdout || process.stdout;
  const stderr = env.stderr || process.stderr;
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
        workspaceRoot: options.workspaceRoot,
        projectPath
      }, { stderr });

      if (analysis.bestPreset && analysis.bestPreset.score > 0) {
        suggestion = analysis.bestPreset.id;
        const matchInfo = `${analysis.bestPreset.fullCount} of ${analysis.bestPreset.componentCount} components matched`;
        stdout.write(`💡 Best match: ${suggestion} (${matchInfo})\n\n`);
      }
    } catch (err) {
      // Surface the failure rather than silently falling back. Most common
      // cause is a .gitignore > 1 MiB (refused by analyzeGitignore), which
      // otherwise looks like "no suggestion available" and confuses users.
      stderr.write(`Could not analyze .gitignore: ${err.message}\n`);
      stderr.write(`Picking from the full preset list instead.\n`);
      debugError(err, 'preset-picker.analyze', { stderr });
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
  for (let i = 0; i < presetIds.length; i++) {
    const marker = presetIds[i] === suggestion ? ' ← suggested' : '';
    stdout.write(`  ${i + 1}. ${presetIds[i]}${marker}\n`);
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
    { stdin, stdout, ask: env.ask, stderr: env.stderr },
    ask => ask(`Pick a preset (name, number, or g/b) [${defaultLabel}]: `)
  );

  if (answer === null) {
    // runWithQuestions gave up under non-interactive mode and there's no safe
    // default to fall back on. Surface this so the caller can exit with a
    // helpful error rather than silently printing exit 1 with no stderr.
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
  if (Number.isInteger(num) && num >= 1 && num <= presetIds.length) return presetIds[num - 1];

  // Try matching by name
  if (presetIds.includes(answer.trim())) return answer.trim();

  stdout.write(`Invalid selection: ${answer.trim()}\n`);
  return null;
}

/**
 * Build the env passed to create workflows (component.js / preset.js).
 * Adds a confirm() callback that prompts the user unless --yes is set or
 * stdin is not a TTY (piped/test input).
 */
function buildCreateEnv(env, skipConfirm) {
  const stdout = env.stdout || process.stdout;
  const result = { stdout, stderr: env.stderr || process.stderr, cwd: env.cwd };

  if (skipConfirm) return result;
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
  const stdout = env.stdout || process.stdout;
  return { stdout, stderr: env.stderr || process.stderr, cwd: env.cwd, stdin: env.stdin, ask: env.ask };
}

// --- Command dispatch ---
// The dispatch is a flat if/else chain rather than a command-registry pattern.
// A registry would reduce line count but adds indirection that makes the
// control flow harder to follow for a CLI with ~10 commands. Revisit if the
// command count grows significantly or if shared middleware (e.g. global
// option validation) becomes repetitive.

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
      const options = applyUserRootDefault(parseArgs(args.slice(1)));
      options.configPath = options._[0];
      if (!options.configPath) {
        throw new Error('explain requires a config path');
      }
      runExplainWorkflow(options, { stdout, stderr, cwd: env.cwd });
      return { exitCode: 0 };
    }

    // Analyze
    if (command === 'analyze') {
      const options = applyUserRootDefault(parseArgs(args.slice(1)));
      options.gitignorePath = options._[0];
      if (!options.gitignorePath) {
        throw new Error('analyze requires a .gitignore path');
      }
      // The cwd is the project root for signal detection. When the .gitignore
      // is in a subdirectory, signal detection must still scan the project root
      // (where package.json, build.gradle, etc. live), not the subdirectory.
      if (!options.projectPath) {
        options.projectPath = env.cwd || process.cwd();
      }
      runAnalyzeWorkflow(options, { stdout, stderr, cwd: env.cwd });
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
      if (options.noGit) {
        options.git = false;
      }
      options.templates = collectRepeated(args.slice(1), '--template');
      options.components = collectRepeated(args.slice(1), '--component');
      options.exclude = collectRepeated(args.slice(1), '--exclude');
      // Route through buildCreateEnv so --yes (and TTY/CI detection) honor the
      // same rules as `adopt` and `create`. Previously `init --yes` was parsed
      // but ignored because init had no confirm gate at all.
      const initEnv = buildCreateEnv({ stdout, stderr, cwd: env.cwd, stdin: env.stdin, ask: env.ask }, options.yes);
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
      options.templates = collectRepeated(args.slice(1), '--template');
      options.components = collectRepeated(args.slice(1), '--component');
      options.exclude = collectRepeated(args.slice(1), '--exclude');
      // Route through buildCreateEnv so --yes (and TTY/CI detection) honor the
      // same rules as `create`. Previously `adopt --yes` still prompted because
      // the inline createConfirm here didn't see the --yes flag.
      const adoptEnv = buildCreateEnv({ stdout, stderr, cwd: env.cwd, stdin: env.stdin, ask: env.ask }, options.yes);
      const result = await runAdoptWorkflow(options, adoptEnv);
      if (result.configPath === null && !result.preview) {
        // user cancelled
        return { exitCode: 1 };
      }
      if (result.configPath) {
        stdout.write(`Adopted ignorekit project at ${result.projectPath}\n`);
      }
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
      const createEnv = buildCreateEnv({ stdout, stderr, cwd: env.cwd, stdin: env.stdin, ask: env.ask }, options.yes);
      if (subcommand === 'component') {
        options.name = options._[0];
        options.rules = collectRepeated(args.slice(2), '--rule');
        if (!options.name) {
          const interactiveEnv = { stdin: env.stdin, stdout, stderr, cwd: env.cwd, ask: env.ask };
          const draft = await runWithQuestions(interactiveEnv, ask => promptComponentCreation(options, {
            cwd: env.cwd || process.cwd(), stdout, stderr, ask
          }));
          if (!draft) return { exitCode: 1 };
          options = { ...options, ...draft };
        }
        const result = await runComponentCreate(options, createEnv);
        return { exitCode: result.outputPath ? 0 : 1 };
      }
      if (subcommand === 'preset') {
        options.name = options._[0];
        options.components = collectRepeated(args.slice(2), '--component');
        if (!options.name) {
          const interactiveEnv = { stdin: env.stdin, stdout, stderr, cwd: env.cwd, ask: env.ask };
          const draft = await runWithQuestions(interactiveEnv, ask => promptPresetCreation(options, {
            cwd: env.cwd || process.cwd(), stdout, stderr, ask
          }));
          if (!draft) return { exitCode: 1 };
          options = { ...options, ...draft };
        }
        const result = await runPresetCreate(options, createEnv);
        return { exitCode: result.outputPath ? 0 : 1 };
      }
      throw new Error('create supports: component, preset');
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    stderr.write(`ignorekit: ${error.message}\n`);
    return { exitCode: 1 };
  }
}

module.exports = { parseArgs, runCli, pickPresetInteractive, runWithQuestions };
