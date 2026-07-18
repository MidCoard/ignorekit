#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const situationsDir = path.join(repoRoot, 'examples', 'situations');
const componentsDir = path.join(repoRoot, 'components');
const presetsDir = path.join(repoRoot, 'presets');

const { listDefinitions: listDefinitionsArray } = require('../src/core/fs');
const { readJson } = require('../src/core/json');
const { validateProviderConfig } = require('../src/core/constants');

const workflows = new Set(['init', 'adopt', 'generate']);
// v0.6.4 implements only one addon: ensureGitRepo, used by init/adopt to
// ensure the target is a Git repo. Other names from earlier drafts
// (`ensureDirectory`, `removeCachedIgnoredFiles`) were dropped — directory
// creation is unconditional and cached-file removal is exposed via the
// `--remove-cached` flag rather than a typed addon block.
const addonTypes = new Set(['ensureGitRepo']);

main();

function main() {
  const errors = [];
  const situations = readSituations(errors);
  const shippedComponents = listDefinitions(componentsDir, '.gitignore');
  const shippedPresets = listDefinitions(presetsDir, '.json');

  for (const situation of situations) {
    validateSituation(situation, {
      shippedComponents,
      shippedPresets,
      errors
    });
  }

  // Validate shipped presets (base references, circular detection, component references)
  validateShippedPresets(shippedPresets, shippedComponents, errors);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`ERROR ${error}`);
    }
    console.error(`Situation validation failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  console.log(`Validated ${situations.length} situation file(s).`);
}

function readSituations(errors) {
  if (!fs.existsSync(situationsDir)) {
    errors.push(`situations directory is missing: ${situationsDir}`);
    return [];
  }

  return fs.readdirSync(situationsDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const filePath = path.join(situationsDir, file);
      try {
        return {
          file,
          filePath,
          data: readJson(filePath)
        };
      } catch (error) {
        errors.push(`${file}: invalid JSON: ${error.message}`);
        return {
          file,
          filePath,
          data: {}
        };
      }
    });
}

function validateSituation(situation, context) {
  const { data, file } = situation;
  const errors = context.errors;
  const label = data.id || file;
  const expectedId = file.replace(/\.json$/, '');

  if (data.version !== 1) {
    errors.push(`${file}: version must be 1`);
  }

  if (data.id !== expectedId) {
    errors.push(`${file}: id must match file name '${expectedId}'`);
  }

  if (!workflows.has(data.workflow)) {
    errors.push(`${label}: unknown workflow '${data.workflow}'`);
  }

  if (typeof data.command !== 'string' || data.command.length === 0) {
    errors.push(`${label}: command is required`);
  } else if (!data.command.includes(data.workflow)) {
    errors.push(`${label}: command should include the workflow name`);
  }

  validateConfig(data, label, context);
  validateGeneration(data, label, errors);
  validateAddons(data, label, errors);
  validateExpected(data, label, errors);
}

function validateConfig(data, label, context) {
  const config = data.config;
  if (!config || typeof config !== 'object') {
    context.errors.push(`${label}: config object is required`);
    return;
  }

  if (config.version !== 1) {
    context.errors.push(`${label}: config.version must be 1`);
  }

  if (config.preset) {
    assertPreset(config.preset, `${label}: config.preset`, context);
  }

  if (Array.isArray(config.components)) {
    for (const component of config.components) {
      assertComponent(component, `${label}: config.components`, context, data);
    }
  }

  if (config.provider) {
    const providerErrors = validateProviderConfig(config.provider);
    for (const error of providerErrors) {
      context.errors.push(`${label}: ${error}`);
    }
  }

  if (config.custom && !Array.isArray(config.custom)) {
    context.errors.push(`${label}: config.custom must be an array when present`);
  }
}

function validateGeneration(data, label, errors) {
  if (!data.generation || typeof data.generation !== 'object') {
    errors.push(`${label}: generation object is required`);
    return;
  }

  if (['init', 'adopt'].includes(data.workflow) && data.generation.enabled !== true) {
    errors.push(`${label}: ${data.workflow} must enable generation`);
  }

  if (data.workflow === 'generate' && data.generation.enabled !== true) {
    errors.push(`${label}: generate must enable generation`);
  }

  if (data.generation.enabled === true && !data.generation.output) {
    errors.push(`${label}: enabled generation requires output`);
  }
}

function validateAddons(data, label, errors) {
  if (!Array.isArray(data.addons)) {
    errors.push(`${label}: addons must be an array`);
    return;
  }

  if (data.workflow === 'generate' && data.addons.length > 0) {
    errors.push(`${label}: generate must not define addons`);
  }

  for (const addon of data.addons) {
    if (!addonTypes.has(addon.type)) {
      errors.push(`${label}: unknown addon type '${addon.type}'`);
      continue;
    }

    if (addon.type === 'ensureGitRepo' && !['init', 'adopt'].includes(data.workflow)) {
      errors.push(`${label}: ensureGitRepo only applies to init/adopt`);
    }
  }
}

function validateExpected(data, label, errors) {
  if (!data.expected || typeof data.expected !== 'object') {
    errors.push(`${label}: expected object is required`);
    return;
  }

  if (['init', 'adopt', 'generate'].includes(data.workflow)) {
    if (!Array.isArray(data.expected.writes) || data.expected.writes.length === 0) {
      errors.push(`${label}: expected.writes must list generated files`);
    }
  }

  // Adopt is preview-only without --apply; a situation that expects writes
  // must include --apply in the command, otherwise the test would always fail
  // (the workflow returns preview: true and writes nothing).
  if (data.workflow === 'adopt' && Array.isArray(data.expected.writes) && data.expected.writes.length > 0) {
    if (!data.command.includes('--apply')) {
      errors.push(`${label}: adopt with expected.writes requires --apply in command`);
    }
  }
}

function assertPreset(preset, location, context) {
  if (context.shippedPresets.has(preset)) {
    return;
  }
  context.errors.push(`${location} references unknown preset '${preset}'`);
}

function assertComponent(component, location, context, data) {
  if (context.shippedComponents.has(component)) {
    return;
  }

  const layers = data.context?.definitionLayers || [];
  if ((component.startsWith('workspace/') && layers.includes('workspace')) ||
      (component.startsWith('user/') && layers.includes('user')) ||
      (component.startsWith('project/') && layers.includes('project'))) {
    return;
  }

  context.errors.push(`${location} references unknown component '${component}'`);
}

function validateShippedPresets(shippedPresets, shippedComponents, errors) {
  const presetData = new Map();
  for (const presetId of shippedPresets) {
    const filePath = path.join(presetsDir, `${presetId}.json`);
    try {
      presetData.set(presetId, readJson(filePath));
    } catch (e) {
      errors.push(`preset ${presetId}: invalid JSON: ${e.message}`);
    }
  }

  for (const [presetId, data] of presetData) {
    // Validate base reference
    if (data.base) {
      if (!shippedPresets.has(data.base)) {
        errors.push(`preset ${presetId}: references unknown base '${data.base}'`);
      }
    }

    // Validate component references
    if (Array.isArray(data.components)) {
      for (const component of data.components) {
        if (!shippedComponents.has(component)) {
          errors.push(`preset ${presetId}: references unknown component '${component}'`);
        }
      }
    }

    // Circular base detection
    if (data.base) {
      const visited = new Set();
      let current = presetId;
      while (current) {
        if (visited.has(current)) {
          errors.push(`preset ${presetId}: circular base inheritance: ${[...visited, current].join(' → ')}`);
          break;
        }
        visited.add(current);
        const currentData = presetData.get(current);
        current = currentData?.base || null;
      }
    }
  }
}

function listDefinitions(directory, extension) {
  return new Set(listDefinitionsArray(directory, extension));
}
