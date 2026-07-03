#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const componentsDir = path.join(repoRoot, 'components');
const presetsDir = path.join(repoRoot, 'presets');
const generatedDir = path.join(repoRoot, 'generated');
const manifestPath = path.join(repoRoot, 'projects.json');

const aliases = new Map([
  ['generate', 'build'],
  ['gen', 'build'],
  ['verify', 'check'],
  ['ls', 'list']
]);

function main() {
  const args = process.argv.slice(2);
  const command = aliases.get(args[0]) || args[0];

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        break;
      case 'list':
        commandList(args.slice(1));
        break;
      case 'build':
        commandBuild(args.slice(1));
        break;
      case 'check':
        commandCheck(args.slice(1));
        break;
      case 'diff':
        commandDiff(args.slice(1));
        break;
      case 'apply':
        commandApply(args.slice(1));
        break;
      default:
        throw new Error(`Unknown command: ${args[0]}`);
    }
  } catch (error) {
    console.error(`ignorekit: ${error.message}`);
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`ignorekit

Usage:
  ignorekit list [components|presets|projects]
  ignorekit build <project> [--root <root>] [--output <path>]
  ignorekit build --preset <preset> [--output <path>]
  ignorekit build --all
  ignorekit check <project> [--root <root>]
  ignorekit check --all
  ignorekit diff <project> [--root <root>]
  ignorekit apply <project> [--root <root>] [--yes]

Concepts:
  component  Atomic ignore type, such as language/java or build/gradle.
  preset     Ordered component list, such as java-gradle or frontend-vite.
  project    Preset plus project-specific custom patterns.
`);
}

function parseOptions(args) {
  const options = { _: [] };

  for (let index = 0; index < args.length; index++) {
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
    index++;
  }

  return options;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function commandList(args) {
  const options = parseOptions(args);
  const target = options._[0] || 'all';

  if (target === 'all' || target === 'components') {
    console.log('Components:');
    for (const component of listComponents()) {
      console.log(`  ${component}`);
    }
  }

  if (target === 'all' || target === 'presets') {
    if (target === 'all') console.log('');
    console.log('Presets:');
    for (const preset of listPresets()) {
      console.log(`  ${preset}`);
    }
  }

  if (target === 'all' || target === 'projects') {
    if (target === 'all') console.log('');
    console.log('Projects:');
    for (const project of loadProjects()) {
      console.log(`  ${project.root}/${project.name} -> ${project.preset}`);
    }
  }

  if (!['all', 'components', 'presets', 'projects'].includes(target)) {
    throw new Error(`Unknown list target: ${target}`);
  }
}

function commandBuild(args) {
  const options = parseOptions(args);

  if (options.all) {
    for (const project of loadProjects()) {
      const outputPath = getGeneratedPath(project);
      writeText(outputPath, buildProject(project));
      console.log(`Generated ${outputPath}`);
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
    const content = buildProject(project);
    if (options.output) {
      writeText(path.resolve(options.output), content);
      console.log(`Generated ${path.resolve(options.output)}`);
    } else {
      process.stdout.write(content);
    }
    return;
  }

  const projectName = options._[0];
  if (!projectName) {
    throw new Error('Use a project name, --preset <preset>, or --all.');
  }

  const project = findProject(projectName, options.root);
  const content = buildProject(project);
  const outputPath = options.output ? path.resolve(options.output) : getGeneratedPath(project);
  writeText(outputPath, content);
  console.log(`Generated ${outputPath}`);
}

function commandCheck(args) {
  const options = parseOptions(args);
  const projects = options.all ? loadProjects() : [findProjectFromOptions(options)];
  let failures = 0;

  for (const project of projects) {
    const actualPath = getProjectGitignorePath(project);
    const expected = normalizeText(buildProject(project));

    if (!fs.existsSync(actualPath)) {
      writeText(getGeneratedPath(project), expected);
      console.log(`MISSING ${project.root}/${project.name}: ${actualPath}`);
      failures++;
      continue;
    }

    const actual = normalizeText(readText(actualPath));
    if (actual === expected) {
      console.log(`OK ${project.root}/${project.name}`);
    } else {
      writeText(getGeneratedPath(project), expected);
      console.log(`DIFF ${project.root}/${project.name}`);
      failures++;
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} project(s) differ from the standard.`);
  }
}

function commandDiff(args) {
  const options = parseOptions(args);
  const project = findProjectFromOptions(options);
  const actualPath = getProjectGitignorePath(project);
  const expectedPath = getGeneratedPath(project);
  writeText(expectedPath, buildProject(project));

  if (!fs.existsSync(actualPath)) {
    console.log(`Actual .gitignore does not exist: ${actualPath}`);
    console.log(`Generated recommendation: ${expectedPath}`);
    return;
  }

  const git = findExecutable('git');
  if (git) {
    const result = childProcess.spawnSync(git, ['diff', '--no-index', '--', actualPath, expectedPath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.status === 1 ? 0 : result.status;
    return;
  }

  const actual = normalizeText(readText(actualPath));
  const expected = normalizeText(readText(expectedPath));
  if (actual === expected) {
    console.log(`No differences for ${project.root}/${project.name}`);
  } else {
    console.log(`Different files:`);
    console.log(`  Actual:   ${actualPath}`);
    console.log(`  Expected: ${expectedPath}`);
  }
}

function commandApply(args) {
  const options = parseOptions(args);
  const project = findProjectFromOptions(options);
  const targetPath = getProjectGitignorePath(project);
  const content = buildProject(project);

  if (!options.yes) {
    const recommendation = getGeneratedPath(project);
    writeText(recommendation, content);
    console.log(`Dry run. Generated ${recommendation}`);
    console.log('Re-run with --yes to overwrite the project .gitignore.');
    return;
  }

  writeText(targetPath, content);
  console.log(`Updated ${targetPath}`);
}

function findProjectFromOptions(options) {
  const projectName = options._[0];
  if (!projectName) {
    throw new Error('Project name is required.');
  }
  return findProject(projectName, options.root);
}

function buildProject(project) {
  const preset = loadPreset(project.preset);
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
    const componentPath = resolveComponentPath(componentId);
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

function loadProjects() {
  const manifest = readJson(manifestPath);
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

function findProject(name, root) {
  const matches = loadProjects().filter((project) => {
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

function listComponents() {
  if (!fs.existsSync(componentsDir)) return [];
  const files = walkFiles(componentsDir).filter((file) => file.endsWith('.gitignore'));
  return files
    .map((file) => path.relative(componentsDir, file).replace(/\\/g, '/').replace(/\.gitignore$/, ''))
    .sort();
}

function listPresets() {
  if (!fs.existsSync(presetsDir)) return [];
  return fs.readdirSync(presetsDir)
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

function loadPreset(name) {
  const presetPath = path.join(presetsDir, `${name}.json`);
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Preset not found: ${name}`);
  }

  const preset = readJson(presetPath);
  if (!Array.isArray(preset.components)) {
    throw new Error(`Preset '${name}' must define a components array.`);
  }
  return preset;
}

function resolveComponentPath(componentId) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(componentId)) {
    throw new Error(`Invalid component id: ${componentId}`);
  }

  const componentPath = path.resolve(componentsDir, `${componentId}.gitignore`);
  const relative = path.relative(componentsDir, componentPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Component escapes components directory: ${componentId}`);
  }

  if (!fs.existsSync(componentPath)) {
    throw new Error(`Component not found: ${componentId}`);
  }
  return componentPath;
}

function getGeneratedPath(project) {
  return path.join(generatedDir, sanitize(project.root), `${sanitize(project.name)}.gitignore`);
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

main();

