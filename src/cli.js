'use strict';

function parseArgs(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const booleanOptions = new Set(['all', 'yes', 'git', 'noGit', 'dryRun', 'preview', 'overwrite']);
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

async function runCli(args, env = {}) {
  const stdout = env.stdout || process.stdout;
  const stderr = env.stderr || process.stderr;
  const command = args[0] || 'help';

  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp(stdout);
      return { exitCode: 0 };
    }
    parseArgs(args.slice(1));
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    stderr.write(`ignorekit: ${error.message}\n`);
    return { exitCode: 1 };
  }
}

module.exports = { parseArgs, runCli };
