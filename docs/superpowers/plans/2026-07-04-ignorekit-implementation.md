# Ignorekit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `ignorekit` as a cross-platform CLI that creates project configs, generates `.gitignore` files from upstream builders plus local definitions, initializes/adopts projects safely, and extracts reusable presets/components.

**Architecture:** Split the current single-file CLI into focused CommonJS modules under `src/`. Keep `generate` pure, put Git and filesystem side effects behind workflow/addon modules, and test each command through Node's built-in `node:test` runner using temporary directories.

**Tech Stack:** Node.js >= 18, CommonJS, built-in `node:test`, built-in `assert`, built-in `fs/path/child_process/https`; no runtime npm dependencies in the first implementation.

---

## Current State

The repository already has:

- `bin/ignorekit.js`: prototype CLI with `list`, `build`, `check`, `diff`, and `apply`.
- `components/`: local ignore fragments.
- `presets/`: local preset JSON.
- `projects.json`: central manifest for existing local projects.
- `docs/structure.md`: command responsibility model.
- `docs/situations.md` and `examples/situations/*.json`: workflow situations and validation.
- `scripts/validate-situations.js`: situation validator.

The next implementation should preserve existing commands where possible, but make these new commands first-class:

- `ignorekit generate <ignorekit.json>`
- `ignorekit init <project-path>`
- `ignorekit adopt <project-path>`
- `ignorekit extract component <id> --from <path>`
- `ignorekit preset create <name>`

## File Structure

Create these implementation files:

- `src/cli.js`: command dispatch, argument parsing, help text.
- `src/core/json.js`: JSON read/write helpers with clear error messages.
- `src/core/text.js`: newline normalization and generated header helpers.
- `src/core/path.js`: path resolution, safe output path checks, definition ID validation.
- `src/definitions/resolver.js`: resolve components and presets from dist/user/workspace/project layers.
- `src/config/project-config.js`: normalize and validate `ignorekit.json`.
- `src/providers/local.js`: build ignore text from local preset/components only.
- `src/providers/gitignore-io.js`: build ignore text from gitignore.io/Toptal API.
- `src/providers/index.js`: provider lookup.
- `src/generator.js`: pure `generate(config, options)` pipeline.
- `src/git.js`: Git detection, `ensureGitRepo`, tracked ignored file discovery, cached removal.
- `src/workflows/init.js`: config creation, generation, init addons.
- `src/workflows/adopt.js`: read existing project, create config, generate preview or replacement, adopt addons.
- `src/workflows/extract.js`: extract component draft from an existing `.gitignore`.
- `src/workflows/preset.js`: create preset definitions.
- `test/helpers/temp-workspace.js`: temp directory helper.
- `test/*.test.js`: unit and command tests.

Modify these files:

- `bin/ignorekit.js`: thin executable wrapper around `src/cli.js`.
- `package.json`: add `test`, `test:unit`, and keep existing scripts.
- `README.md`: update commands once implemented.
- `docs/structure.md`: update only if implementation reveals a concrete naming mismatch.

Do not remove the legacy PowerShell scripts in this plan. They can stay as compatibility helpers until the Node CLI covers all used workflows.

---

### Task 1: Add Test Harness And Thin CLI Wrapper

**Files:**
- Modify: `package.json`
- Modify: `bin/ignorekit.js`
- Create: `src/cli.js`
- Create: `test/helpers/temp-workspace.js`
- Create: `test/cli.test.js`

- [ ] **Step 1: Add the Node test scripts**

Modify `package.json` scripts to include:

```json
{
  "scripts": {
    "build:all": "node bin/ignorekit.js build --all",
    "check": "node bin/ignorekit.js check --all",
    "list": "node bin/ignorekit.js list",
    "validate:situations": "node scripts/validate-situations.js",
    "test": "node --test test/*.test.js",
    "test:unit": "node --test test/*.test.js"
  }
}
```

- [ ] **Step 2: Create the temporary workspace helper**

Create `test/helpers/temp-workspace.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createTempWorkspace(prefix = 'ignorekit-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  return {
    root,
    path: (...parts) => path.join(root, ...parts),
    writeJson(relativePath, value) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
      return target;
    },
    writeText(relativePath, value) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, value, 'utf8');
      return target;
    },
    readText(relativePath) {
      return fs.readFileSync(path.join(root, relativePath), 'utf8');
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

module.exports = { createTempWorkspace };
```

- [ ] **Step 3: Write failing CLI help tests**

Create `test/cli.test.js`:

```js
'use strict';

const assert = require('assert');
const test = require('node:test');
const { runCli } = require('../src/cli');

test('help prints the implemented command groups', async () => {
  const writes = [];
  const result = await runCli(['help'], {
    stdout: { write: (text) => writes.push(String(text)) },
    stderr: { write: () => {} },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 0);
  const output = writes.join('');
  assert.match(output, /ignorekit/);
  assert.match(output, /generate <config>/);
  assert.match(output, /init <project-path>/);
  assert.match(output, /adopt <project-path>/);
  assert.match(output, /extract component <id>/);
  assert.match(output, /preset create <name>/);
});

test('unknown command returns exit code 1', async () => {
  const errors = [];
  const result = await runCli(['unknown-command'], {
    stdout: { write: () => {} },
    stderr: { write: (text) => errors.push(String(text)) },
    cwd: process.cwd()
  });

  assert.equal(result.exitCode, 1);
  assert.match(errors.join(''), /Unknown command/);
});
```

- [ ] **Step 4: Run tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because `src/cli.js` does not exist.

- [ ] **Step 5: Add minimal CLI module and wrapper**

Create `src/cli.js`:

```js
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
```

Replace `bin/ignorekit.js` with:

```js
#!/usr/bin/env node
'use strict';

const { runCli } = require('../src/cli');

runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd()
}).then((result) => {
  process.exitCode = result.exitCode;
});
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm run test:unit
```

Expected: PASS.

Commit:

```bash
git add package.json bin/ignorekit.js src/cli.js test/helpers/temp-workspace.js test/cli.test.js
git commit -m "test: add ignorekit cli harness"
```

---

### Task 2: Implement Definition Resolution And Project Config Validation

**Files:**
- Create: `src/core/json.js`
- Create: `src/core/text.js`
- Create: `src/core/path.js`
- Create: `src/definitions/resolver.js`
- Create: `src/config/project-config.js`
- Create: `test/definitions.test.js`
- Create: `test/project-config.test.js`

- [ ] **Step 1: Write definition resolver tests**

Create `test/definitions.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { createDefinitionResolver } = require('../src/definitions/resolver');

test('resolver reads components from dist, user, workspace, and project layers in priority order', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeText('workspace/.ignorekit/components/local/logs.gitignore', 'workspace-logs/\n');
    workspace.writeText('project/.ignorekit/components/project/runtime.gitignore', 'runtime/\n');

    const resolver = createDefinitionResolver({
      distRoot: workspace.path('dist'),
      userRoot: workspace.path('missing-user'),
      workspaceRoot: workspace.path('workspace/.ignorekit'),
      projectRoot: workspace.path('project/.ignorekit')
    });

    assert.equal(resolver.readComponent('local/logs').trim(), 'workspace-logs/');
    assert.equal(resolver.readComponent('project/runtime').trim(), 'runtime/');
  } finally {
    workspace.cleanup();
  }
});

test('resolver rejects component ids that escape definition roots', () => {
  const workspace = createTempWorkspace();
  try {
    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    assert.throws(() => resolver.readComponent('../secret'), /Invalid definition id/);
  } finally {
    workspace.cleanup();
  }
});
```

- [ ] **Step 2: Write project config validation tests**

Create `test/project-config.test.js`:

```js
'use strict';

const assert = require('assert');
const test = require('node:test');
const { normalizeProjectConfig } = require('../src/config/project-config');

test('normalizes a project config with preset, provider, components, and custom rules', () => {
  const config = normalizeProjectConfig({
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    provider: { name: 'gitignore.io', templates: ['java', 'gradle'] },
    components: ['local/logs'],
    custom: ['/runtime/']
  });

  assert.deepEqual(config, {
    version: 1,
    name: 'demo',
    preset: 'java-gradle',
    provider: { name: 'gitignore.io', templates: ['java', 'gradle'] },
    components: ['local/logs'],
    custom: ['/runtime/'],
    addons: {}
  });
});

test('rejects configs without version 1', () => {
  assert.throws(() => normalizeProjectConfig({ name: 'demo' }), /version must be 1/);
});

test('rejects provider templates that are not arrays', () => {
  assert.throws(() => normalizeProjectConfig({
    version: 1,
    name: 'demo',
    provider: { name: 'gitignore.io', templates: 'java' }
  }), /provider.templates must be an array/);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because the resolver and config modules do not exist.

- [ ] **Step 4: Implement JSON and path helpers**

Create `src/core/json.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read JSON ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

module.exports = { readJson, writeJson };
```

Create `src/core/path.js`:

```js
'use strict';

const path = require('path');

const definitionIdPattern = /^[a-z0-9][a-z0-9._/-]*$/i;

function assertDefinitionId(id) {
  if (!definitionIdPattern.test(id) || id.includes('..')) {
    throw new Error(`Invalid definition id: ${id}`);
  }
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const relation = path.relative(root, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`Path escapes root: ${relativePath}`);
  }
  return target;
}

module.exports = { assertDefinitionId, resolveInside };
```

Create `src/core/text.js`:

```js
'use strict';

function normalizeText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() + '\n';
}

module.exports = { normalizeText };
```

- [ ] **Step 5: Implement resolver and config validation**

Create `src/definitions/resolver.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('../core/json');
const { assertDefinitionId, resolveInside } = require('../core/path');

function createDefinitionResolver(options = {}) {
  const layers = [
    options.distRoot,
    options.userRoot,
    options.workspaceRoot,
    options.projectRoot
  ].filter(Boolean);

  function findDefinition(kind, id, extension) {
    assertDefinitionId(id);
    for (const root of [...layers].reverse()) {
      const filePath = resolveInside(root, path.join(kind, `${id}${extension}`));
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    throw new Error(`Unknown ${kind.slice(0, -1)}: ${id}`);
  }

  return {
    readComponent(id) {
      return fs.readFileSync(findDefinition('components', id, '.gitignore'), 'utf8');
    },
    readPreset(id) {
      return readJson(findDefinition('presets', id, '.json'));
    },
    hasComponent(id) {
      try {
        findDefinition('components', id, '.gitignore');
        return true;
      } catch {
        return false;
      }
    },
    hasPreset(id) {
      try {
        findDefinition('presets', id, '.json');
        return true;
      } catch {
        return false;
      }
    }
  };
}

module.exports = { createDefinitionResolver };
```

Create `src/config/project-config.js`:

```js
'use strict';

function normalizeProjectConfig(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('config must be an object');
  }
  if (input.version !== 1) {
    throw new Error('config.version must be 1');
  }
  if (!input.name || typeof input.name !== 'string') {
    throw new Error('config.name is required');
  }

  const provider = input.provider || { name: 'local' };
  if (!provider.name || typeof provider.name !== 'string') {
    throw new Error('provider.name is required');
  }
  if (provider.name !== 'local' && !Array.isArray(provider.templates)) {
    throw new Error('provider.templates must be an array');
  }

  return {
    version: 1,
    name: input.name,
    preset: input.preset,
    provider,
    components: Array.isArray(input.components) ? input.components : [],
    custom: Array.isArray(input.custom) ? input.custom : [],
    addons: input.addons && typeof input.addons === 'object' ? input.addons : {}
  };
}

module.exports = { normalizeProjectConfig };
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm run test:unit
```

Expected: PASS.

Commit:

```bash
git add src/core src/definitions src/config test/definitions.test.js test/project-config.test.js
git commit -m "feat: resolve ignorekit definitions"
```

---

### Task 3: Implement Provider Abstraction And Pure Generator

**Files:**
- Create: `src/providers/local.js`
- Create: `src/providers/gitignore-io.js`
- Create: `src/providers/index.js`
- Create: `src/generator.js`
- Create: `test/generator.test.js`

- [ ] **Step 1: Write generator tests**

Create `test/generator.test.js`:

```js
'use strict';

const assert = require('assert');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { createDefinitionResolver } = require('../src/definitions/resolver');
const { generateGitignore } = require('../src/generator');

test('generator combines provider text, preset components, config components, and custom rules', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n*.log\n');
    workspace.writeText('dist/components/local/secrets.gitignore', '.env\n');
    workspace.writeJson('dist/presets/demo.json', {
      name: 'demo',
      components: ['local/logs']
    });

    const resolver = createDefinitionResolver({ distRoot: workspace.path('dist') });
    const content = await generateGitignore({
      config: {
        version: 1,
        name: 'demo-project',
        preset: 'demo',
        provider: { name: 'local' },
        components: ['local/secrets'],
        custom: ['/runtime/'],
        addons: {}
      },
      resolver
    });

    assert.match(content, /Generated by ignorekit/);
    assert.match(content, /Preset: demo/);
    assert.match(content, /logs\//);
    assert.match(content, /\.env/);
    assert.match(content, /\/runtime\//);
  } finally {
    workspace.cleanup();
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because `src/generator.js` does not exist.

- [ ] **Step 3: Implement providers**

Create `src/providers/local.js`:

```js
'use strict';

async function buildLocalProviderText() {
  return '';
}

module.exports = { buildLocalProviderText };
```

Create `src/providers/gitignore-io.js`:

```js
'use strict';

const https = require('https');

function fetchGitignoreIoTemplates(templates) {
  const encoded = templates.map(encodeURIComponent).join(',');
  const url = `https://www.toptal.com/developers/gitignore/api/${encoded}`;

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`gitignore.io returned HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    }).on('error', reject);
  });
}

async function buildGitignoreIoProviderText(provider, options = {}) {
  if (options.fetchText) {
    return options.fetchText(provider.templates);
  }
  return fetchGitignoreIoTemplates(provider.templates);
}

module.exports = { buildGitignoreIoProviderText, fetchGitignoreIoTemplates };
```

Create `src/providers/index.js`:

```js
'use strict';

const { buildLocalProviderText } = require('./local');
const { buildGitignoreIoProviderText } = require('./gitignore-io');

async function buildProviderText(provider, options = {}) {
  if (!provider || provider.name === 'local') {
    return buildLocalProviderText(provider, options);
  }
  if (provider.name === 'gitignore.io') {
    return buildGitignoreIoProviderText(provider, options);
  }
  throw new Error(`Unknown provider: ${provider.name}`);
}

module.exports = { buildProviderText };
```

- [ ] **Step 4: Implement pure generator**

Create `src/generator.js`:

```js
'use strict';

const { normalizeText } = require('./core/text');
const { normalizeProjectConfig } = require('./config/project-config');
const { buildProviderText } = require('./providers');

async function generateGitignore({ config, resolver, providerOptions = {} }) {
  const normalized = normalizeProjectConfig(config);
  const preset = normalized.preset ? resolver.readPreset(normalized.preset) : { components: [] };
  const presetComponents = Array.isArray(preset.components) ? preset.components : [];
  const componentIds = [...presetComponents, ...normalized.components];

  const lines = [
    '# Generated by ignorekit',
    `# Project: ${normalized.name}`,
    normalized.preset ? `# Preset: ${normalized.preset}` : '# Preset: none',
    '# Components:'
  ];

  for (const componentId of componentIds) {
    lines.push(`# - ${componentId}`);
  }
  lines.push('# Edit ignorekit.json or shared definitions, then regenerate.');
  lines.push('');

  const providerText = normalizeText(await buildProviderText(normalized.provider, providerOptions)).trim();
  if (providerText) {
    lines.push('# Provider templates');
    lines.push(providerText);
    lines.push('');
  }

  for (const componentId of componentIds) {
    const componentText = normalizeText(resolver.readComponent(componentId)).trim();
    if (componentText) {
      lines.push(componentText);
      lines.push('');
    }
  }

  if (normalized.custom.length > 0) {
    lines.push('# Project-specific ignores');
    for (const pattern of normalized.custom) {
      lines.push(String(pattern));
    }
    lines.push('');
  }

  return normalizeText(lines.join('\n'));
}

module.exports = { generateGitignore };
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm run test:unit
```

Expected: PASS.

Commit:

```bash
git add src/providers src/generator.js test/generator.test.js
git commit -m "feat: generate gitignore from providers and components"
```

---

### Task 4: Implement `generate <config>` Command

**Files:**
- Modify: `src/cli.js`
- Create: `test/generate-command.test.js`

- [ ] **Step 1: Write command tests**

Create `test/generate-command.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('generate writes .gitignore from a project config and does not require Git', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    const configPath = workspace.writeJson('project/ignorekit.json', {
      version: 1,
      name: 'project',
      preset: 'demo',
      provider: { name: 'local' },
      custom: ['/runtime/']
    });

    const result = await runCli(['generate', configPath, '--dist-root', workspace.path('dist')], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.path('project')
    });

    assert.equal(result.exitCode, 0);
    const output = fs.readFileSync(workspace.path('project/.gitignore'), 'utf8');
    assert.match(output, /logs\//);
    assert.match(output, /\/runtime\//);
  } finally {
    workspace.cleanup();
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because `generate` is not dispatched.

- [ ] **Step 3: Implement command dispatch**

Modify `src/cli.js` to import and call the generator:

```js
const path = require('path');
const { readJson } = require('./core/json');
const { createDefinitionResolver } = require('./definitions/resolver');
const { generateGitignore } = require('./generator');
```

Add this helper:

```js
function createResolverFromOptions(options, configPath) {
  const projectRoot = path.dirname(path.resolve(configPath));
  return createDefinitionResolver({
    distRoot: options.distRoot || path.resolve(__dirname, '..'),
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot
  });
}
```

Add this command handler:

```js
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
  require('fs').writeFileSync(outputPath, content, 'utf8');
  env.stdout.write(`Generated ${outputPath}\n`);
}
```

In `runCli`, dispatch:

```js
if (command === 'generate') {
  await commandGenerate(args.slice(1), { stdout, stderr, cwd: env.cwd });
  return { exitCode: 0 };
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm run test:unit
npm run validate:situations
```

Expected: both PASS.

Commit:

```bash
git add src/cli.js test/generate-command.test.js
git commit -m "feat: add pure generate command"
```

---

### Task 5: Implement Git Addons And `init`

**Files:**
- Create: `src/git.js`
- Create: `src/workflows/init.js`
- Modify: `src/cli.js`
- Create: `test/git.test.js`
- Create: `test/init-command.test.js`

- [ ] **Step 1: Write Git helper tests**

Create `test/git.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { createTempWorkspace } = require('./helpers/temp-workspace');
const { getGitState } = require('../src/git');

test('getGitState detects a repo root by .git directory', () => {
  const workspace = createTempWorkspace();
  try {
    fs.mkdirSync(workspace.path('project/.git'), { recursive: true });
    assert.equal(getGitState(workspace.path('project')).state, 'repo-root');
  } finally {
    workspace.cleanup();
  }
});

test('getGitState detects a worktree or submodule by .git file', () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.git', 'gitdir: ../.git/worktrees/project\n');
    assert.equal(getGitState(workspace.path('project')).state, 'git-file');
  } finally {
    workspace.cleanup();
  }
});
```

- [ ] **Step 2: Write init workflow test**

Create `test/init-command.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('init creates config and gitignore without forcing git init when --no-git is used', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });

    const result = await runCli([
      'init',
      workspace.path('project'),
      '--preset',
      'demo',
      '--no-git',
      '--dist-root',
      workspace.path('dist'),
      '--yes'
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), true);
    assert.equal(fs.existsSync(workspace.path('project/.gitignore')), true);
    assert.equal(fs.existsSync(workspace.path('project/.git')), false);
  } finally {
    workspace.cleanup();
  }
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because `src/git.js` and `init` are missing.

- [ ] **Step 4: Implement Git helpers**

Create `src/git.js`:

```js
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

function getGitState(projectPath) {
  const dotGit = path.join(projectPath, '.git');
  if (fs.existsSync(dotGit)) {
    const stat = fs.statSync(dotGit);
    return { state: stat.isDirectory() ? 'repo-root' : 'git-file', path: dotGit };
  }
  const result = childProcess.spawnSync('git', ['-C', projectPath, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8'
  });
  if (result.status === 0) {
    return { state: 'inside-parent-repo', root: result.stdout.trim() };
  }
  return { state: 'not-a-repo' };
}

function ensureGitRepo(projectPath, options = {}) {
  const state = getGitState(projectPath);
  if (state.state === 'repo-root' || state.state === 'git-file') {
    return { action: 'skipped', reason: state.state };
  }
  if (state.state === 'inside-parent-repo' && !options.allowNested) {
    throw new Error(`Refusing to initialize nested Git repo inside ${state.root}`);
  }
  const result = childProcess.spawnSync('git', ['init'], {
    cwd: projectPath,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git init failed');
  }
  return { action: 'initialized' };
}

module.exports = { getGitState, ensureGitRepo };
```

- [ ] **Step 5: Implement init workflow**

Create `src/workflows/init.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { createDefinitionResolver } = require('../definitions/resolver');
const { generateGitignore } = require('../generator');
const { ensureGitRepo } = require('../git');

async function runInitWorkflow(options, env) {
  const projectPath = path.resolve(env.cwd || process.cwd(), options.projectPath);
  fs.mkdirSync(projectPath, { recursive: true });

  const config = {
    version: 1,
    name: path.basename(projectPath),
    preset: options.preset,
    provider: { name: options.provider || 'local' },
    components: options.components || [],
    custom: [],
    addons: {}
  };

  const configPath = path.join(projectPath, 'ignorekit.json');
  if (fs.existsSync(configPath) && !options.overwrite) {
    throw new Error(`Config already exists: ${configPath}`);
  }
  writeJson(configPath, config);

  const resolver = createDefinitionResolver({
    distRoot: options.distRoot || path.resolve(__dirname, '..', '..'),
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: projectPath
  });
  const gitignore = await generateGitignore({ config, resolver });
  fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore, 'utf8');

  if (options.git) {
    ensureGitRepo(projectPath, { allowNested: options.allowNestedGit });
  }

  return { projectPath, configPath };
}

module.exports = { runInitWorkflow };
```

Modify `src/cli.js` to dispatch `init`:

```js
const { runInitWorkflow } = require('./workflows/init');
```

```js
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
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm run test:unit
npm run validate:situations
```

Expected: both PASS.

Commit:

```bash
git add src/git.js src/workflows/init.js src/cli.js test/git.test.js test/init-command.test.js
git commit -m "feat: add init workflow"
```

---

### Task 6: Implement `adopt` And Cached Removal Addon

**Files:**
- Modify: `src/git.js`
- Create: `src/workflows/adopt.js`
- Modify: `src/cli.js`
- Create: `test/adopt-command.test.js`

- [ ] **Step 1: Write adopt preview test**

Create `test/adopt-command.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('adopt writes ignorekit config and preview gitignore by default', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('dist/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('dist/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeText('project/.gitignore', 'old-rule\n');

    const result = await runCli([
      'adopt',
      workspace.path('project'),
      '--preset',
      'demo',
      '--dist-root',
      workspace.path('dist')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(workspace.path('project/ignorekit.json')), true);
    assert.equal(fs.existsSync(workspace.path('project/.gitignore.preview')), true);
    assert.equal(workspace.readText('project/.gitignore'), 'old-rule\n');
  } finally {
    workspace.cleanup();
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because `adopt` is not implemented.

- [ ] **Step 3: Add tracked ignored file helpers**

Modify `src/git.js`:

```js
function listTrackedIgnoredFiles(projectPath) {
  const result = childProcess.spawnSync('git', ['ls-files', '-ci', '--exclude-standard', '-z'], {
    cwd: projectPath,
    encoding: 'buffer'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString('utf8') || 'git ls-files failed');
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function removeCachedFiles(projectPath, files, options = {}) {
  if (files.length === 0) {
    return { action: 'none', files: [] };
  }
  if (options.dryRun) {
    return { action: 'dry-run', files };
  }
  const result = childProcess.spawnSync('git', ['rm', '--cached', '--', ...files], {
    cwd: projectPath,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git rm --cached failed');
  }
  return { action: 'removed', files };
}
```

Export the new functions:

```js
module.exports = { getGitState, ensureGitRepo, listTrackedIgnoredFiles, removeCachedFiles };
```

- [ ] **Step 4: Implement adopt workflow**

Create `src/workflows/adopt.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson } = require('../core/json');
const { createDefinitionResolver } = require('../definitions/resolver');
const { generateGitignore } = require('../generator');
const { listTrackedIgnoredFiles, removeCachedFiles } = require('../git');

async function runAdoptWorkflow(options, env) {
  const projectPath = path.resolve(env.cwd || process.cwd(), options.projectPath);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  const config = {
    version: 1,
    name: path.basename(projectPath),
    preset: options.preset,
    provider: { name: options.provider || 'local' },
    components: options.components || [],
    custom: [],
    addons: {}
  };

  const configPath = path.join(projectPath, 'ignorekit.json');
  if (!fs.existsSync(configPath) || options.overwriteConfig) {
    writeJson(configPath, config);
  }

  const resolver = createDefinitionResolver({
    distRoot: options.distRoot || path.resolve(__dirname, '..', '..'),
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: projectPath
  });
  const gitignore = await generateGitignore({ config, resolver });
  const outputName = options.apply ? '.gitignore' : '.gitignore.preview';
  fs.writeFileSync(path.join(projectPath, outputName), gitignore, 'utf8');

  let cachedRemoval = { action: 'skipped', files: [] };
  if (options.removeCached) {
    const files = listTrackedIgnoredFiles(projectPath);
    cachedRemoval = removeCachedFiles(projectPath, files, { dryRun: !options.yes });
  }

  return { projectPath, configPath, cachedRemoval };
}

module.exports = { runAdoptWorkflow };
```

Modify `src/cli.js` to dispatch `adopt`:

```js
const { runAdoptWorkflow } = require('./workflows/adopt');
```

```js
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
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm run test:unit
npm run validate:situations
```

Expected: both PASS.

Commit:

```bash
git add src/git.js src/workflows/adopt.js src/cli.js test/adopt-command.test.js
git commit -m "feat: add adopt workflow"
```

---

### Task 7: Implement Extract And Preset Creation

**Files:**
- Create: `src/workflows/extract.js`
- Create: `src/workflows/preset.js`
- Modify: `src/cli.js`
- Create: `test/extract-command.test.js`
- Create: `test/preset-command.test.js`

- [ ] **Step 1: Write extract and preset tests**

Create `test/extract-command.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('extract component writes a reusable component draft', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('project/.gitignore', 'logs/\n.env\n');
    const result = await runCli([
      'extract',
      'component',
      'local/runtime',
      '--from',
      workspace.path('project/.gitignore'),
      '--output-root',
      workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const output = fs.readFileSync(workspace.path('defs/components/local/runtime.gitignore'), 'utf8');
    assert.match(output, /logs\//);
    assert.match(output, /\.env/);
  } finally {
    workspace.cleanup();
  }
});
```

Create `test/preset-command.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('preset create writes a preset with base and component references', async () => {
  const workspace = createTempWorkspace();
  try {
    const result = await runCli([
      'preset',
      'create',
      'java-gradle-focess',
      '--base',
      'java-gradle',
      '--component',
      'local/focess-runtime',
      '--output-root',
      workspace.path('defs')
    ], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.root
    });

    assert.equal(result.exitCode, 0);
    const preset = JSON.parse(fs.readFileSync(workspace.path('defs/presets/java-gradle-focess.json'), 'utf8'));
    assert.equal(preset.name, 'java-gradle-focess');
    assert.equal(preset.base, 'java-gradle');
    assert.deepEqual(preset.components, ['local/focess-runtime']);
  } finally {
    workspace.cleanup();
  }
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because `extract` and `preset create` are not implemented.

- [ ] **Step 3: Implement extract workflow**

Create `src/workflows/extract.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { assertDefinitionId, resolveInside } = require('../core/path');
const { normalizeText } = require('../core/text');

function runExtractComponent(options, env) {
  assertDefinitionId(options.id);
  const sourcePath = path.resolve(env.cwd || process.cwd(), options.from);
  const outputRoot = path.resolve(env.cwd || process.cwd(), options.outputRoot || '.ignorekit');
  const outputPath = resolveInside(outputRoot, path.join('components', `${options.id}.gitignore`));
  const source = fs.readFileSync(sourcePath, 'utf8');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, normalizeText(source), 'utf8');
  return { outputPath };
}

module.exports = { runExtractComponent };
```

- [ ] **Step 4: Implement preset creation workflow**

Create `src/workflows/preset.js`:

```js
'use strict';

const path = require('path');
const { writeJson } = require('../core/json');
const { assertDefinitionId, resolveInside } = require('../core/path');

function runPresetCreate(options, env) {
  assertDefinitionId(options.name);
  const outputRoot = path.resolve(env.cwd || process.cwd(), options.outputRoot || '.ignorekit');
  const outputPath = resolveInside(outputRoot, path.join('presets', `${options.name}.json`));
  const components = Array.isArray(options.components) ? options.components : [];
  const preset = {
    name: options.name,
    base: options.base,
    components
  };
  writeJson(outputPath, preset);
  return { outputPath, preset };
}

module.exports = { runPresetCreate };
```

- [ ] **Step 5: Dispatch extract and preset commands**

Modify `src/cli.js` imports:

```js
const { runExtractComponent } = require('./workflows/extract');
const { runPresetCreate } = require('./workflows/preset');
```

Add an option parser helper for repeated `--component`:

```js
function collectRepeated(args, optionName) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === optionName && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}
```

Dispatch:

```js
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
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm run test:unit
npm run validate:situations
```

Expected: both PASS.

Commit:

```bash
git add src/workflows/extract.js src/workflows/preset.js src/cli.js test/extract-command.test.js test/preset-command.test.js
git commit -m "feat: extract components and create presets"
```

---

### Task 8: Restore Legacy Commands On The New Modules

**Files:**
- Modify: `src/cli.js`
- Create: `src/legacy/projects-manifest.js`
- Create: `test/legacy-command.test.js`

- [ ] **Step 1: Write legacy build test**

Create `test/legacy-command.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const test = require('node:test');
const { runCli } = require('../src/cli');
const { createTempWorkspace } = require('./helpers/temp-workspace');

test('legacy build reads projects.json and writes generated recommendation', async () => {
  const workspace = createTempWorkspace();
  try {
    workspace.writeText('repo/components/local/logs.gitignore', 'logs/\n');
    workspace.writeJson('repo/presets/demo.json', { name: 'demo', components: ['local/logs'] });
    workspace.writeJson('repo/projects.json', {
      version: 1,
      projects: [
        {
          root: 'TestRoot',
          name: 'demo',
          path: workspace.path('project'),
          preset: 'demo',
          custom: ['/runtime/']
        }
      ]
    });

    const result = await runCli(['build', 'demo', '--root', 'TestRoot', '--repo-root', workspace.path('repo')], {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: workspace.path('repo')
    });

    assert.equal(result.exitCode, 0);
    const output = fs.readFileSync(workspace.path('repo/generated/TestRoot/demo.gitignore'), 'utf8');
    assert.match(output, /logs\//);
    assert.match(output, /\/runtime\//);
  } finally {
    workspace.cleanup();
  }
});
```

- [ ] **Step 2: Implement manifest lookup**

Create `src/legacy/projects-manifest.js`:

```js
'use strict';

const path = require('path');
const { readJson } = require('../core/json');

function loadProjectsManifest(repoRoot) {
  const manifest = readJson(path.join(repoRoot, 'projects.json'));
  return Array.isArray(manifest.projects) ? manifest.projects : [];
}

function findManifestProject(projects, name, root) {
  const matches = projects.filter((project) => project.name === name && (!root || project.root === root));
  if (matches.length === 0) {
    throw new Error(root ? `Project not found: ${root}/${name}` : `Project not found: ${name}`);
  }
  if (matches.length > 1) {
    throw new Error(`Project name '${name}' is ambiguous. Use --root.`);
  }
  return matches[0];
}

module.exports = { loadProjectsManifest, findManifestProject };
```

- [ ] **Step 3: Dispatch legacy `build` through the generator**

Modify `src/cli.js` to support:

```js
if (command === 'build') {
  const options = parseArgs(args.slice(1));
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '..'));
  const projects = require('./legacy/projects-manifest').loadProjectsManifest(repoRoot);
  const project = require('./legacy/projects-manifest').findManifestProject(projects, options._[0], options.root);
  const resolver = createDefinitionResolver({
    distRoot: repoRoot,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot,
    projectRoot: project.path
  });
  const content = await generateGitignore({
    config: {
      version: 1,
      name: project.name,
      preset: project.preset,
      provider: project.provider || { name: 'local' },
      components: project.components || [],
      custom: project.custom || [],
      addons: {}
    },
    resolver
  });
  const outputPath = path.join(repoRoot, 'generated', project.root, `${project.name}.gitignore`);
  require('fs').mkdirSync(path.dirname(outputPath), { recursive: true });
  require('fs').writeFileSync(outputPath, content, 'utf8');
  stdout.write(`Generated ${outputPath}\n`);
  return { exitCode: 0 };
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm run test:unit
npm run build:all
npm run validate:situations
```

Expected: all PASS.

Commit:

```bash
git add src/legacy src/cli.js test/legacy-command.test.js generated
git commit -m "feat: route legacy build through generator"
```

---

### Task 9: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/structure.md`
- Modify: `docs/situations.md`
- Modify: `examples/README.md`

- [ ] **Step 1: Update README command examples**

Add these commands to `README.md`:

```bash
node bin/ignorekit.js generate ./ignorekit.json
node bin/ignorekit.js init D:/IdeaProjects/demo --preset java-gradle --git
node bin/ignorekit.js adopt D:/IdeaProjects/veto --preset java-gradle
node bin/ignorekit.js extract component local/focess-runtime --from D:/IdeaProjects/focess-api/.gitignore
node bin/ignorekit.js preset create java-gradle-focess --base java-gradle --component local/focess-runtime
```

- [ ] **Step 2: Update structure docs with implemented file map**

Add this implementation map to `docs/structure.md`:

```markdown
## Implementation Map

- `src/generator.js` owns pure `.gitignore` generation.
- `src/providers/*` owns upstream/local builder integration.
- `src/definitions/resolver.js` owns dist/user/workspace/project definition lookup.
- `src/workflows/init.js` owns new-project config creation and init addons.
- `src/workflows/adopt.js` owns existing-project config creation and adopt addons.
- `src/workflows/extract.js` owns component extraction.
- `src/workflows/preset.js` owns direct preset creation.
- `src/git.js` owns Git state and cached removal operations.
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run test:unit
npm run validate:situations
npm run build:all
node bin/ignorekit.js help
node bin/ignorekit.js init ./tmp-plan-smoke --preset generic-idea --no-git --yes
node bin/ignorekit.js generate ./tmp-plan-smoke/ignorekit.json
node bin/ignorekit.js adopt ./tmp-plan-smoke --preset generic-idea
```

Expected:

- `npm run test:unit`: PASS.
- `npm run validate:situations`: prints `Validated 9 situation file(s).`
- `npm run build:all`: generates all recommendations.
- `help`: prints all implemented commands.
- `init`: creates `tmp-plan-smoke/ignorekit.json` and `tmp-plan-smoke/.gitignore`.
- `generate`: rewrites `tmp-plan-smoke/.gitignore`.
- `adopt`: writes `tmp-plan-smoke/.gitignore.preview`.

- [ ] **Step 4: Remove smoke directory safely**

Run from repo root:

```powershell
$root = (Resolve-Path '.').Path
$target = Join-Path $root 'tmp-plan-smoke'
if (Test-Path $target) {
  $resolved = (Resolve-Path $target).Path
  if ($resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
```

Expected: `tmp-plan-smoke` no longer exists.

- [ ] **Step 5: Commit docs**

Run:

```bash
git add README.md docs/structure.md docs/situations.md examples/README.md
git commit -m "docs: document implemented ignorekit workflows"
```

---

## Self-Review

Spec coverage:

- `init` creates config, generates `.gitignore`, and can ensure Git safely: Task 5.
- `adopt` creates config, generates preview or replacement, and supports cached removal: Task 6.
- `generate` is pure and has no addons: Task 4.
- `extract` creates reusable components: Task 7.
- `preset create` directly creates presets: Task 7.
- Definition layers are represented by resolver options: Task 2.
- Provider-backed generation exists with local and gitignore.io providers: Task 3.
- Existing central manifest workflow remains available through legacy `build`: Task 8.

Placeholder scan:

- This plan contains no placeholder markers and no deferred unnamed validation steps.

Type consistency:

- `normalizeProjectConfig`, `createDefinitionResolver`, `generateGitignore`, `runInitWorkflow`, `runAdoptWorkflow`, `runExtractComponent`, and `runPresetCreate` are defined before they are used by later tasks.

Residual implementation choices:

- The first provider-backed implementation supports `local` and `gitignore.io`. `gibo` remains represented in docs and validation, but implementation can be added after the provider interface is stable.
- The smoke test directory is under the repo root and has an explicit safe removal command.
