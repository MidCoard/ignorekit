# ignorekit Structure

`ignorekit` is organized around definitions, project configs, generation, and workflow addons.

## Definition Layers

Definitions are resolved from lowest to highest priority:

```text
dist      shipped presets/components/providers
user      ~/.ignorekit overrides and personal definitions
workspace <workspace>/.ignorekit org or workspace definitions
project   <project>/ignorekit.json project config and custom rules
```

The first implementation stores shipped definitions directly in this repository:

```text
components/
presets/
projects.json
```

The long-term layout can map those to:

```text
dist/
  components/
  presets/
  providers/
```

## Terms

`component`
: A reusable `.gitignore` fragment, such as `language/java` or `local/logs`.

`preset`
: An ordered recipe that composes provider templates and components.

`provider`
: An upstream builder such as `gitignore.io`, `gibo`, or a local component-only builder.

`project config`
: The `ignorekit.json` for a project. It chooses a preset and adds project-specific rules.

`addon`
: A workflow action, not an ignore fragment. Examples: `ensureGitRepo`, `removeCachedIgnoredFiles`.

## Command Responsibilities

`init`
: Create project config, generate `.gitignore`, and run init addons.

`adopt`
: Create project config for an existing project, generate `.gitignore`, and run adopt addons.

`generate`
: Pure generation from config to `.gitignore`; no Git side effects.

`extract`
: Convert an existing `.gitignore` into a reusable component or preset draft.

`preset create`
: Directly create a preset from provider templates and components.

## Invariants

- `init` and `adopt` include generation by default.
- `generate` is pure and must not run addons.
- `addon` means workflow operation, not ignore content.
- Project custom rules stay in `custom`.
- Reusable ignore rules belong in `components`.
- Shared recipes belong in `presets`.

## Implementation Map

- `src/cli.js` owns command dispatch, argument parsing, and help text.
- `src/generator.js` owns pure `.gitignore` generation from config + resolver.
- `src/providers/local.js` owns the local-only builder (no upstream).
- `src/providers/gitignore-io.js` owns the gitignore.io/Toptal API integration.
- `src/providers/index.js` owns provider lookup by name.
- `src/definitions/resolver.js` owns dist/user/workspace/project definition lookup.
- `src/config/project-config.js` owns normalize and validate `ignorekit.json`.
- `src/core/json.js` owns JSON read/write helpers.
- `src/core/text.js` owns newline normalization and generated header helpers.
- `src/core/path.js` owns path resolution, definition ID validation, safe output checks.
- `src/git.js` owns Git state detection, `ensureGitRepo`, tracked ignored file discovery, cached removal.
- `src/workflows/init.js` owns new-project config creation and init addons.
- `src/workflows/adopt.js` owns existing-project config creation and adopt addons.
- `src/workflows/extract.js` owns component extraction from an existing `.gitignore`.
- `src/workflows/preset.js` owns direct preset creation.
- `src/legacy/projects-manifest.js` owns the central `projects.json` manifest lookup.
- `src/legacy-cli.js` owns the legacy commands (list, build, check, diff, apply).
- `test/helpers/temp-workspace.js` owns the temporary directory helper for tests.

