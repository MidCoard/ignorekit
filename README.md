# ignorekit

A cross-platform CLI tool for building `.gitignore` files from composable components and presets. Zero runtime dependencies, Node.js >= 18.

## How it works

```
components → presets → project custom rules → generated .gitignore
```

- **Components** are atomic ignore rules: `platform/windows`, `language/java`, `build/gradle`, etc.
- **Presets** are project-type templates that group components together: `java-gradle`, `frontend-vite`, `generic`, etc.
- **Custom rules** are project-specific patterns that don't fit any component.

You describe *what* your project is (via a preset + components + custom rules), and ignorekit generates the `.gitignore`. When you change the config, regenerate — same config always produces the same output.

## What is a preset?

A preset is a **project type template**. It answers the question: "what kind of project is this?" Each preset bundles the components that make sense for that project type:

| Preset | Project type | What it includes |
|--------|-------------|-----------------|
| `generic` | Any project | platform, editor, secrets, logs, AI assistant |
| `java-gradle` | Java + Gradle | generic + Java + Gradle + Java IDE metadata |
| `java-maven` | Java + Maven | generic + Java + Maven + Java IDE metadata |
| `frontend-vite` | Vue/React/Svelte + Vite | generic + Node + Vite |
| `scientific` | Research / ML / data analysis | generic + scientific artifacts |
| `blank` | Start from scratch | nothing — you build it yourself |

Presets are **starting points**, not cages. You can always add extra components or custom rules on top.

## Commands

### `list` — Browse what's available

```bash
ignorekit list                # all components and presets
ignorekit list components     # just components
ignorekit list presets        # just presets
```

### `init` — Start a new project

```bash
ignorekit init                                    # interactive: pick preset, use current dir
ignorekit init ./my-app --preset java-gradle --git
ignorekit init ./web-app --preset frontend-vite --no-git
```

If `--preset` is omitted, an interactive picker shows all presets with the best match suggested.

### `adopt` — Bring an existing project into ignorekit

```bash
ignorekit adopt                                   # interactive: analyze, pick preset, preview
ignorekit adopt --preset java-gradle              # use current directory
ignorekit adopt --preset java-gradle --apply      # overwrite .gitignore directly
```

Adopt analyzes your existing `.gitignore`, shows what's already covered by components, carries over custom rules, and generates a `.gitignore.preview` for review.

### `generate` — Build .gitignore from config

```bash
ignorekit generate ./ignorekit.json
ignorekit generate ./ignorekit.json --output ./path/.gitignore
```

Pure — no Git side effects.

### `explain` — Understand your config

```bash
ignorekit explain ./ignorekit.json
ignorekit explain ./ignorekit.json --verbose
```

Shows what each component in your config contributes, like `EXPLAIN` in SQL. No generation — just transparency.

### `analyze` — Reverse-engineer a .gitignore

```bash
ignorekit analyze ./.gitignore
ignorekit analyze ./.gitignore --suggest-preset
```

Matches lines against known components, shows coverage, identifies custom rules, and suggests the best preset.

### `extract` — Create a reusable component

```bash
ignorekit extract component local/custom --from ./.gitignore    # smart: only unmatched lines
ignorekit extract component local/runtime --from ./.gitignore --full  # entire file
```

Analyzes the `.gitignore` first, then extracts only the lines not covered by any known component.

### `preset` — Create a preset definition

```bash
ignorekit preset create my-stack --component language/java --component language/node
ignorekit preset create java-extended --base java-gradle --component local/custom
```

## Project config

Projects use `ignorekit.json`:

```json
{
  "version": 1,
  "name": "my-project",
  "preset": "java-gradle",
  "components": ["local/ai-codegraph"],
  "custom": [
    "MIGRATION.md",
    "src/main/resources/application-local.yml"
  ]
}
```

- `preset` — base project type template
- `components` — extra components on top of the preset
- `custom` — project-specific patterns (always the last section in the generated file)

## Components

| Category | Components |
|----------|-----------|
| Platform | `platform/macos`, `platform/windows` |
| Editor | `editor/jetbrains`, `editor/vscode`, `editor/temporary-files`, `editor/java-ide-metadata` |
| Language | `language/java`, `language/node` |
| Build | `build/gradle`, `build/maven` |
| Framework | `framework/vite` |
| Domain | `domain/scientific-artifacts` |
| Local | `local/env-secrets`, `local/logs` |
| AI tools | `local/ai-claude`, `local/ai-gemini`, `local/ai-codex`, `local/ai-codegraph` |

AI tool components are opt-in — only `local/ai-claude` is included in presets by default. Add others as extra components in your `ignorekit.json`.

## Running tests

```bash
npm run test:unit
```
