# ignorekit

`ignorekit` is a cross-platform tool for building `.gitignore` files from composable ignore types.

The goal is not to scan every project and guess forever. The goal is to keep ignore rules decomposed, named, reusable, and reproducible:

```text
components -> presets -> project custom rules -> generated .gitignore
```

## Model

Detailed model docs:

- `docs/model.md`
- `docs/structure.md`
- `docs/situations.md`

### Component

A component is one atomic ignore type:

- `platform/windows`
- `platform/macos`
- `editor/jetbrains`
- `editor/vscode`
- `language/java`
- `build/gradle`
- `build/maven`
- `language/node`
- `framework/vite`
- `local/env-secrets`
- `local/logs`

Components live in `components/`.

### Preset

A preset is an ordered list of components:

- `java-gradle`
- `java-maven`
- `frontend-vite`
- `generic-idea`
- `scientific-artifacts`

Presets live in `presets/`.

### Project Custom Rules

Projects choose a preset, then add only their own runtime/data rules:

```json
{
  "version": 1,
  "name": "veto",
  "preset": "java-gradle",
  "custom": [
    "/vault/",
    "/audit/",
    "/models/",
    "*.gguf"
  ]
}
```

Project config lives in `<project>/ignorekit.json`.

## Commands

```bash
# List available components and presets
ignorekit list
ignorekit list components
ignorekit list presets

# Generate .gitignore from a project config (pure, no Git side effects)
ignorekit generate ./ignorekit.json

# Initialize a new project
ignorekit init ./my-app --preset java-gradle --git
ignorekit init ./web-app --preset frontend-vite --no-git

# Adopt an existing project
ignorekit adopt ./existing-project --preset java-gradle
ignorekit adopt ./existing-project --preset java-gradle --apply

# Extract a reusable component from an existing .gitignore
ignorekit extract component local/runtime --from ./project/.gitignore

# Create a new preset
ignorekit preset create java-gradle-extended --base java-gradle --component local/runtime
```

Run `ignorekit help <command>` for detailed usage of any command.

## Running Tests

```bash
npm run test:unit
```

## Policy Notes

- Keep build wrappers trackable, especially `gradle/wrapper/gradle-wrapper.jar`.
- Keep frontend lockfiles trackable.
- Do not hide broad source categories like all Markdown files unless a project has an explicit local-only reason.
- Put personal machine/editor noise in a global Git excludes file when it does not belong to the team.
