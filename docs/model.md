# ignorekit Model

`ignorekit` separates ignore rules into three concepts.

## Components

Components are atomic ignore types. They should have one responsibility and should not pull in unrelated concerns.

Good examples:

- `language/java`: Java compiler output.
- `build/gradle`: Gradle build output and cache.
- `editor/jetbrains`: JetBrains project metadata.
- `local/env-secrets`: local environment and secret files.

Bad examples:

- `java-all`: mixes language, build tool, editor, and local secrets.
- `frontend`: too broad to know whether React, Vite, Next.js, or npm-specific output is included.

## Presets

Presets are ordered component lists. They encode common project types without adding project-specific runtime files.

Example:

```json
{
  "name": "java-gradle",
  "components": [
    "platform/macos",
    "platform/windows",
    "editor/jetbrains",
    "editor/vscode",
    "local/env-secrets",
    "local/logs",
    "language/java",
    "build/gradle"
  ]
}
```

## Project Custom Rules

Project custom rules are for files that only that project creates or treats as local runtime state.

Examples:

- `/vault/`
- `/audit/`
- `/public/config.json`
- `*.gguf`

These rules should stay small. If the same custom rule appears across many projects, promote it into a component.

## Generated Files

Generated `.gitignore` files are reproducible. Edit the source files instead:

- component rules in `components/`
- preset component order in `presets/`
- project custom rules in `projects.json`

