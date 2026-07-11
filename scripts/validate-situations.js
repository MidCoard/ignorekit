#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const situationsDir = path.join(repoRoot, 'examples', 'situations');
const componentsDir = path.join(repoRoot, 'components');
const presetsDir = path.join(repoRoot, 'presets');

const { listDefinitions: listDefinitionsArray } = require('../src/core/fs');

const workflows = new Set(['init', 'adopt', 'generate', 'extract', 'preset-create']);
const addonTypes = new Set(['ensureDirectory', 'ensureGitRepo', 'removeCachedIgnoredFiles']);
const providerNames = new Set(['local', 'gitignore.io']);

main();

function main() {
  const errors = [];
  const situations = readSituations(errors);
  const shippedComponents = listDefinitions(componentsDir, '.gitignore');
  const shippedPresets = listDefinitions(presetsDir, '.json');
  const produced = collectProducedDefinitions(situations);

  for (const situation of situations) {
    validateSituation(situation, {
      shippedComponents,
      shippedPresets,
      produced,
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
          data: JSON.parse(fs.readFileSync(filePath, 'utf8'))
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

function collectProducedDefinitions(situations) {
  const produced = {
    components: new Set(),
    presets: new Set()
  };

  for (const situation of situations) {
    const data = situation.data;

    if (data.extract?.output?.kind === 'component' && data.extract.output.id) {
      produced.components.add(data.extract.output.id);
    }

    if (data.extract?.output?.kind === 'preset' && data.extract.output.id) {
      produced.presets.add(data.extract.output.id);
    }

    if (data.presetDefinition?.name) {
      produced.presets.add(data.presetDefinition.name);
    }
  }

  return produced;
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
  } else if (!data.command.includes(data.workflow === 'preset-create' ? 'preset create' : data.workflow)) {
    errors.push(`${label}: command should include the workflow name`);
  }

  validateConfig(data, label, context);
  validateGeneration(data, label, errors);
  validateAddons(data, label, errors);
  validateExtract(data, label, context);
  validatePresetDefinition(data, label, context);
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
    if (!providerNames.has(config.provider.name)) {
      context.errors.push(`${label}: unknown provider '${config.provider.name}'`);
    }

    if (config.provider.name !== 'local') {
      if (!Array.isArray(config.provider.templates) || config.provider.templates.length === 0) {
        context.errors.push(`${label}: provider '${config.provider.name}' requires non-empty templates`);
      }
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

  if (data.workflow === 'extract' && data.addons.length > 0) {
    errors.push(`${label}: extract must not define workflow addons`);
  }

  for (const addon of data.addons) {
    if (!addonTypes.has(addon.type)) {
      errors.push(`${label}: unknown addon type '${addon.type}'`);
      continue;
    }

    if (addon.type === 'ensureGitRepo' && !['init', 'adopt'].includes(data.workflow)) {
      errors.push(`${label}: ensureGitRepo only applies to init/adopt`);
    }

    if (addon.type === 'removeCachedIgnoredFiles' && data.workflow !== 'adopt') {
      errors.push(`${label}: removeCachedIgnoredFiles only applies to adopt`);
    }
  }
}

function validateExtract(data, label, context) {
  if (data.workflow !== 'extract') {
    return;
  }

  if (!data.extract?.source) {
    context.errors.push(`${label}: extract.source is required`);
  }

  if (!data.extract?.output?.kind || !['component', 'preset'].includes(data.extract.output.kind)) {
    context.errors.push(`${label}: extract.output.kind must be component or preset`);
  }

  if (!data.extract?.output?.id) {
    context.errors.push(`${label}: extract.output.id is required`);
  }
}

function validatePresetDefinition(data, label, context) {
  if (data.workflow !== 'preset-create') {
    return;
  }

  const definition = data.presetDefinition;
  if (!definition) {
    context.errors.push(`${label}: presetDefinition is required`);
    return;
  }

  if (!definition.name) {
    context.errors.push(`${label}: presetDefinition.name is required`);
  }

  if (definition.base) {
    assertPreset(definition.base, `${label}: presetDefinition.base`, context);
  }

  if (!Array.isArray(definition.components)) {
    context.errors.push(`${label}: presetDefinition.components must be an array`);
  } else {
    for (const component of definition.components) {
      assertComponent(component, `${label}: presetDefinition.components`, context, data);
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
}

function assertPreset(preset, location, context) {
  if (context.shippedPresets.has(preset) || context.produced.presets.has(preset)) {
    return;
  }
  context.errors.push(`${location} references unknown preset '${preset}'`);
}

function assertComponent(component, location, context, data) {
  if (context.shippedComponents.has(component) || context.produced.components.has(component)) {
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
      presetData.set(presetId, JSON.parse(fs.readFileSync(filePath, 'utf8')));
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

