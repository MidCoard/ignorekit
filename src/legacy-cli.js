'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const defaultRepoRoot = path.resolve(__dirname, '..');
const legacyCommands = new Set(['list', 'build', 'check', 'diff', 'apply']);

function createContext(env = {}) {
  const repoRoot = path.resolve(env.repoRoot || defaultRepoRoot);

  return {
    repoRoot,
    componentsDir: path.join(repoRoot, 'components'),
    presetsDir: path.join(repoRoot, 'presets'),
    generatedDir: path.join(repoRoot, 'generated'),
    manifestPath: path.join(repoRoot, 'projects.json'),
    stdout: env.stdout || process.stdout,
    stderr: env.stderr || process.stderr,
    cwd: env.cwd || process.cwd(),
    exitCode: 0
  };
}

async function runLegacyCommand(command, args, env = {}) {
  const context = createContext(env);

  switch (command) {
    case 'list':
      commandList(args, context);
      break;
    case 'build':
      commandBuild(args, context);
      break;
    case 'check':
      commandCheck(args, context);
      break;
    case 'diff':
      commandDiff(args, context);
      break;
    case 'apply':
      commandApply(args, context);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  return { exitCode: context.exitCode };
}

function parseOptions(args) {
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const key = toCamelCase(rawKey);

    if (['all', 'yes', 'json'].includes(key)) {
      options[key] = true;
      continue;
    }

    if (inlineValue !== undefined && inlineValue !== '') {
      options[key] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Option --${rawKey} requires a value.`);
    }
    options[key] = next;
    index += 1;
  }

  return options;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function commandList(args, context) {
  const options = parseOptions(args);
  const target = options._[0] || 'all';

  if (target === 'all' || target === 'components') {
    writeLine(context, 'Components:');
    for (const component of listComponents(context)) {
      writeLine(context, `  ${component}`);
    }
  }

  if (target === 'all' || target === 'presets') {
    if (target === 'all') writeLine(context, '');
    writeLine(context, 'Presets:');
    for (const preset of listPresets(context)) {
      writeLine(context, `  ${preset}`);
    }
  }

  if (target === 'all' || target === 'projects') {
    if (target === 'all') writeLine(context, '');
    writeLine(context, 'Projects:');
    for (const project of loadProjects(context)) {
      writeLine(context, `  ${project.root}/${project.name} -> ${project.preset}`);
    }
  }

  if (!['all', 'components', 'presets', 'projects'].includes(target)) {
    throw new Error(`Unknown list target: ${target}`);
  }
}

function commandBuild(args, context) {
  const options = parseOptions(args);

  if (options.all) {
    for (const project of loadProjects(context)) {
      const outputPath = getGeneratedPath(project, context);
      writeText(outputPath, buildProject(project, context));
      writeLine(context, `Generated ${outputPath}`);
    }
    return;
  }

  if (options.preset) {
    const project = {
      root: 'presets',
      name: options.preset,
      preset: options.preset,
      custom: []
    };
    const content = buildProject(project, context);
    if (options.output) {
      const outputPath = path.resolve(context.cwd, options.output);
      writeText(outputPath, content);
      writeLine(context, `Generated ${outputPath}`);
    } else {
      context.stdout.write(content);
    }
    return;
  }

  const projectName = options._[0];
  if (!projectName) {
    throw new Error('Use a project name, --preset <preset>, or --all.');
  }

  const project = findProject(projectName, options.root, context);
  const content = buildProject(project, context);
  const outputPath = options.output ? path.resolve(context.cwd, options.output) : getGeneratedPath(project, context);
  writeText(outputPath, content);
  writeLine(context, `Generated ${outputPath}`);
}

function commandCheck(args, context) {
  const options = parseOptions(args);
  const projects = options.all ? loadProjects(context) : [findProjectFromOptions(options, context)];
  let failures = 0;

  for (const project of projects) {
    const actualPath = getProjectGitignorePath(project);
    const expected = normalizeText(buildProject(project, context));

    if (!fs.existsSync(actualPath)) {
      writeText(getGeneratedPath(project, context), expected);
      writeLine(context, `MISSING ${project.root}/${project.name}: ${actualPath}`);
      failures += 1;
      continue;
    }

    const actual = normalizeText(readText(actualPath));
    if (actual === expected) {
      writeLine(context, `OK ${project.root}/${project.name}`);
    } else {
      writeText(getGeneratedPath(project, context), expected);
      writeLine(context, `DIFF ${project.root}/${project.name}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} project(s) differ from the standard.`);
  }
}

function commandDiff(args, context) {
  const options = parseOptions(args);
  const project = findProjectFromOptions(options, context);
  const actualPath = getProjectGitignorePath(project);
  const expectedPath = getGeneratedPath(project, context);
  writeText(expectedPath, buildProject(project, context));

  if (!fs.existsSync(actualPath)) {
    writeLine(context, `Actual .gitignore does not exist: ${actualPath}`);
    writeLine(context, `Generated recommendation: ${expectedPath}`);
    return;
  }

  const git = findExecutable('git');
  if (git) {
    const result = childProcess.spawnSync(git, ['diff', '--no-index', '--', actualPath, expectedPath], {
      cwd: context.repoRoot,
      encoding: 'utf8'
    });

    if (result.stdout) context.stdout.write(result.stdout);
    if (result.stderr) context.stderr.write(result.stderr);
    context.exitCode = result.status === 1 ? 0 : (result.status || 0);
    return;
  }

  const actual = normalizeText(readText(actualPath));
  const expected = normalizeText(readText(expectedPath));
  if (actual === expected) {
    writeLine(context, `No differences for ${project.root}/${project.name}`);
  } else {
    writeLine(context, 'Different files:');
    writeLine(context, `  Actual:   ${actualPath}`);
    writeLine(context, `  Expected: ${expectedPath}`);
  }
}

function commandApply(args, context) {
  const options = parseOptions(args);
  const project = findProjectFromOptions(options, context);
  const targetPath = getProjectGitignorePath(project);
  const content = buildProject(project, context);

  if (!options.yes) {
    const recommendation = getGeneratedPath(project, context);
    writeText(recommendation, content);
    writeLine(context, `Dry run. Generated ${recommendation}`);
    writeLine(context, 'Re-run with --yes to overwrite the project .gitignore.');
    return;
  }

  writeText(targetPath, content);
  writeLine(context, `Updated ${targetPath}`);
}

function findProjectFromOptions(options, context) {
  const projectName = options._[0];
  if (!projectName) {
    throw new Error('Project name is required.');
  }
  return findProject(projectName, options.root, context);
}

function buildProject(project, context) {
  const preset = loadPreset(project.preset, context);
  const lines = [
    '# Generated by ignorekit',
    `# Project: ${project.root}/${project.name}`,
    `# Preset: ${project.preset}`,
    '# Components:'
  ];

  for (const componentId of preset.components) {
    lines.push(`# - ${componentId}`);
  }

  lines.push('# Edit components, presets, or project custom rules, then regenerate.');
  lines.push('');

  for (const componentId of preset.components) {
    const componentPath = resolveComponentPath(componentId, context);
    const text = readText(componentPath).trim();
    if (text) {
      lines.push(text);
      lines.push('');
    }
  }

  const custom = Array.isArray(project.custom) ? project.custom : [];
  if (custom.length > 0) {
    lines.push('# Project-specific ignores');
    for (const pattern of custom) {
      lines.push(String(pattern));
    }
    lines.push('');
  }

  return normalizeText(lines.join('\n'));
}

function loadProjects(context) {
  const manifest = readJson(context.manifestPath);
  const projects = Array.isArray(manifest.projects) ? manifest.projects : [];
  return projects.map(normalizeProject);
}

function normalizeProject(project) {
  return {
    root: project.root || 'projects',
    name: project.name,
    path: project.path,
    preset: project.preset || project.profile,
    custom: project.custom || project.extraPatterns || [],
    components: project.components || [],
    detected: project.detected || []
  };
}

function findProject(name, root, context) {
  const matches = loadProjects(context).filter((project) => {
    return project.name === name && (!root || project.root === root);
  });

  if (matches.length === 0) {
    throw new Error(root ? `Project not found: ${root}/${name}` : `Project not found: ${name}`);
  }

  if (matches.length > 1) {
    const choices = matches.map((project) => `${project.root}/${project.name}`).join(', ');
    throw new Error(`Project name '${name}' is ambiguous. Use --root. Matches: ${choices}`);
  }

  return matches[0];
}

function listComponents(context) {
  if (!fs.existsSync(context.componentsDir)) return [];
  const files = walkFiles(context.componentsDir).filter((file) => file.endsWith('.gitignore'));
  return files
    .map((file) => path.relative(context.componentsDir, file).replace(/\\/g, '/').replace(/\.gitignore$/, ''))
    .sort();
}

function listPresets(context) {
  if (!fs.existsSync(context.presetsDir)) return [];
  return fs.readdirSync(context.presetsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
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

function loadPreset(name, context) {
  const presetPath = path.join(context.presetsDir, `${name}.json`);
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Preset not found: ${name}`);
  }

  const preset = readJson(presetPath);
  if (!Array.isArray(preset.components)) {
    throw new Error(`Preset '${name}' must define a components array.`);
  }
  return preset;
}

function resolveComponentPath(componentId, context) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(componentId)) {
    throw new Error(`Invalid component id: ${componentId}`);
  }

  const componentPath = path.resolve(context.componentsDir, `${componentId}.gitignore`);
  const relative = path.relative(context.componentsDir, componentPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Component escapes components directory: ${componentId}`);
  }

  if (!fs.existsSync(componentPath)) {
    throw new Error(`Component not found: ${componentId}`);
  }
  return componentPath;
}

function getGeneratedPath(project, context) {
  return path.join(context.generatedDir, sanitize(project.root), `${sanitize(project.name)}.gitignore`);
}

function getProjectGitignorePath(project) {
  if (!project.path) {
    throw new Error(`Project '${project.root}/${project.name}' does not define a path.`);
  }
  return path.join(project.path, '.gitignore');
}

function sanitize(value) {
  return String(value).replace(/[\\/:*?"<>|]/g, '_');
}

function normalizeText(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() + '\n';
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalizeText(content), 'utf8');
}

function findExecutable(name) {
  const command = os.platform() === 'win32' ? 'where' : 'command';
  const args = os.platform() === 'win32' ? [name] : ['-v', name];
  const result = childProcess.spawnSync(command, args, { encoding: 'utf8', shell: os.platform() !== 'win32' });
  return result.status === 0 ? name : null;
}

function writeLine(context, text) {
  context.stdout.write(`${text}\n`);
}

module.exports = {
  legacyCommands,
  runLegacyCommand
};
