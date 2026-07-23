# ignorekit

A cross-platform CLI tool for building `.gitignore` files from composable components and presets. Zero runtime dependencies, Node.js >= 18.

## Quick start

```bash
npm install -g ignorekit

ignorekit init ./my-project --preset node --git   # new project
ignorekit adopt --preset vite              # existing project
ignorekit generate ./ignorekit.json                # rebuild .gitignore
```

## How it works

```
components → presets → project custom rules → generated .gitignore
```

- **Components** are atomic ignore rules: `platform/windows`, `language/java`, `build/gradle`, etc.
- **Presets** are project-type templates that group components together. Presets can extend other presets via a `base` field, forming an inheritance chain: `django` extends `python` extends `generic`.
- **Custom rules** are project-specific patterns that don't fit any component.

You describe *what* your project is (via a preset + components + custom rules), and ignorekit generates the `.gitignore`. When you change the config, regenerate — same config always produces the same output.

## What is a preset?

A preset is a **project type template**. It answers the question: "what kind of project is this?" Each preset bundles the components that make sense for that project type. Presets can extend other presets — a `django` preset extends `python`, which extends `generic`. The base chain is resolved automatically: `django` gets all of `python`'s components plus `generic`'s, then adds its own.

| Preset | Base | Project type | Own components |
|--------|------|-------------|----------------|
| `generic` | — | Any project | platform, editor, secrets, logs |
| `blank` | — | Start from scratch | none |
| `node` | generic | Node.js project | language/node |
| `node-pnpm` | node | Node.js + pnpm | package/pnpm |
| `node-yarn` | node | Node.js + Yarn | package/yarn |
| `vite` | node | Vite frontend project | framework/vite, testing/browser-e2e |
| `next` | node | Next.js project | framework/next, testing/browser-e2e |
| `nuxt` | vite | Nuxt project | framework/nuxt |
| `sveltekit` | vite | SvelteKit project | framework/sveltekit |
| `angular` | node | Angular project | framework/angular |
| `java-gradle` | generic | Java + Gradle | language/java, build/gradle, editor/java-ide-metadata |
| `java-maven` | generic | Java + Maven | language/java, build/maven, editor/java-ide-metadata |
| `python` | generic | Python project | language/python, package/pip |
| `python-poetry` | python | Python + Poetry | package/poetry |
| `django` | python | Django web project | framework/django |
| `flask` | python | Flask web project | framework/flask |
| `rust` | generic | Rust project | language/rust |
| `go` | generic | Go project | language/go |
| `ruby` | generic | Ruby project | language/ruby |
| `php` | generic | PHP project | language/php |
| `c` | generic | C project | language/c-cpp |
| `cpp` | generic | C++ project | language/c-cpp |
| `cpp-cmake` | cpp | C++ + CMake | build/cmake |
| `scientific` | generic | Research / ML / data analysis | domain/scientific-artifacts |

Presets are **starting points**, not cages. You can always add extra components or custom rules on top.

## Commands

### `list` — Browse what's available

```bash
ignorekit list                # all components and presets
ignorekit list components     # just components
ignorekit list presets        # just presets (shows inheritance chain)
```

### `init` — Start a new project

```bash
ignorekit init                                    # interactive: pick preset, use current dir
ignorekit init ./my-app --preset java-gradle --git
ignorekit init ./web-app --preset vite
ignorekit init ./my-app --preset node --exclude platform/windows
ignorekit init ./my-app --preset node --dry-run
```

If `--preset` is omitted, an interactive picker shows all presets with the best
match suggested. The picker also offers two quick options: `generic` (safe
default for any project) and `blank` (no components). When there's no suggestion
from analysis, pressing Enter selects `generic`.

### `adopt` — Bring an existing project into ignorekit

```bash
ignorekit adopt                                   # fully interactive
ignorekit adopt --preset java-gradle              # interactive with preset chosen
ignorekit adopt --preset node --exclude platform/windows
ignorekit adopt --preset java-gradle --component language/node  # mixed project
ignorekit adopt --preset java-gradle --confirm    # overwrite an existing .gitignore without asking
ignorekit adopt --preset generic --dry-run         # preview both files without writing
```

Adopt analyzes your existing `.gitignore`, shows strong component matches, carries over only rules not covered by your chosen preset or extra components, and writes `.gitignore` and `ignorekit.json` after you confirm.

**Interactive flow:** analyze, pick a preset, choose extra components, review the config and preview, then confirm any existing files before writing.

**Flags:** `--overwrite-config` replaces an existing config, `--preview` shows the generated `.gitignore` directly, `--confirm` skips the existing `.gitignore` overwrite prompt, and `--dry-run` previews both outputs without writing files or changing Git's index.

Use repeatable `--component <id>` options for mixed projects; the selected components are saved in `ignorekit.json`.

### `generate` — Build .gitignore from config

```bash
ignorekit generate ./ignorekit.json
ignorekit generate ./ignorekit.json --output ./path/.gitignore
```

`generate` only writes the output file by default. `--remove-cached` is an explicit opt-in to remove already-tracked ignored files from Git's index. `--dry-run` previews the generated file and makes no file or Git-index changes.

### `explain` — Understand your config

```bash
ignorekit explain ./ignorekit.json
ignorekit explain ./ignorekit.json --verbose
```

Shows what each component in your config contributes, grouped by inheritance level. Like `EXPLAIN` in SQL — no generation, just transparency.

### `analyze` — Reverse-engineer a .gitignore

```bash
ignorekit analyze ./.gitignore
ignorekit analyze ./.gitignore --suggest-preset
```

Matches lines against known components, shows coverage, identifies custom rules, and suggests the best preset. Standard project manifests such as `package.json`, `build.gradle`, and `pom.xml` improve suggestions without changing extracted rules.

### `create` — Create reusable definitions

```bash
ignorekit create component                                       # guided rule selection and review
ignorekit create component runtime --category local --from ./.gitignore
ignorekit create component local/runtime --from ./.gitignore     # category/name shorthand
ignorekit create component docker --category deployment --rule docker-compose.override.yml
ignorekit create component runtime --category local --rule foo --rule bar   # literal rules
ignorekit create preset                                          # guided base and component selection
ignorekit create preset team-vite --base vite --component local/runtime
```

Components use a separate category and name; `runtime` with category `local`
is stored as `components/local/runtime.gitignore`. The positional name can
include a category prefix using slash syntax: `local/runtime` is equivalent
to `--category local --name runtime`. Guided creation lists every
candidate rule or component, lets you choose a subset, then shows the final
output path before it writes anything.

Pass `--workspace-root <path>` to create definitions in a team-shared root
when `--output-root` is omitted. `--dry-run` shows the planned target and
content without creating a definition.

**Smart extraction** is automatic when `--from <path>` is used: the source
.gitignore is analyzed against known components and only the *unmatched* (custom)
rules are extracted. To write literal rules, pass `--rule <pattern>` instead
(skipping analysis). This is useful for extracting project-specific rules from
an existing `.gitignore` while skipping rules already covered by known components.

**Interactive rule selection** (no `--rule`): when a source is provided
interactively, you see every rule with `[x]` / `[ ]` markers (covered rules
pre-deselected), and you can toggle individual rules:

```
Rules (5, 3 selected):
  [ ] 1. .idea/         (covered by editor/jetbrains)
  [ ] 2. *.iml          (covered by editor/jetbrains)
  [x] 3. cache/
  [x] 4. secret.key
  [x] 5. MIGRATION.md
Toggle rules (e.g. 3, 1-3, all, none) [done]: 
```

Type a number to toggle, `1-3` to toggle a range, `all` / `none`, or `done` to
confirm.

**Confirmation prompt**: before writing any file, both `create component` and
`create preset` show a preview and ask `Proceed? [Y/n]`. In non-interactive environments the confirmation prompt is skipped.

## Project config

Projects use `ignorekit.json`:

```json
{
  "version": 1,
  "name": "my-project",
  "preset": "java-gradle",
  "components": ["local/ai-codegraph"],
  "exclude": ["platform/windows"],
  "custom": [
    "MIGRATION.md",
    "src/main/resources/application-local.yml"
  ]
}
```

- `preset` — base project type template (resolves the full inheritance chain)
- `components` — extra components on top of the preset
- `exclude` — components from the preset chain to omit (e.g., `platform/windows` on a Windows-only team)
- `custom` — project-specific patterns (always the last section in the generated file)

## Reusable definitions

`ignorekit create component` and `ignorekit create preset` save reusable definitions to
`~/.ignorekit` by default. They are picked up automatically by every command,
so a new `local/runtime` component or `team-stack` preset can be used straight
away without extra flags.

For definitions shared across a team, use `--workspace-root` to point at a
shared `.ignorekit` directory (e.g. in a monorepo or team config repo).
For `remove`, `--workspace-root` is also the deletion target unless an explicit
`--output-root` is supplied.
Use `--dry-run` with `init`, `adopt`, `generate`, `create`, or `remove` to
preview a write or deletion without changing files, Git state, or the index.

## Components

| Category | Components |
|----------|-----------|
| Platform | `platform/macos`, `platform/windows` |
| Editor | `editor/jetbrains`, `editor/vscode`, `editor/temporary-files`, `editor/java-ide-metadata` |
| Language | `language/java`, `language/node`, `language/python`, `language/rust`, `language/go`, `language/ruby`, `language/php`, `language/c-cpp` |
| Build | `build/gradle`, `build/maven`, `build/cmake` |
| Package | `package/pip`, `package/poetry`, `package/pnpm`, `package/yarn` |
| Framework | `framework/vite`, `framework/next`, `framework/nuxt`, `framework/angular`, `framework/sveltekit`, `framework/django`, `framework/flask` |
| Testing | `testing/browser-e2e` |
| Domain | `domain/scientific-artifacts` |
| Local | `local/env-secrets`, `local/logs`, `local/assistant-artifacts` |
| AI tools | `local/ai-claude`, `local/ai-gemini`, `local/ai-codex`, `local/ai-codegraph` |

AI tool components are opt-in. Add the tools your project actually uses as extra components in `ignorekit.json`.

## Global flags

| Flag | Effect |
|------|--------|
| `--version` | Print version and exit |
| `--help` | Show help; `ignorekit <command> --help` for command details |

## Environment variables

| Variable | Effect |
|----------|--------|
| `IGNOREKIT_DEBUG` | When set to any non-empty value, prints internal error messages that are otherwise swallowed (analysis failures, preset chain errors, etc.) to stderr. Useful when something silently does the wrong thing. |
| `IGNOREKIT_USER_ROOT` | Overrides the user definition root (default: `~/.ignorekit`). |
| `IGNOREKIT_DIST_ROOT` | Overrides the shipped definition root. Intended for testing or embedded distributions. |
| `IGNOREKIT_NONINTERACTIVE` | When set, skips every interactive prompt (preset picker, guided creation, confirmations) instead of hanging. Returns an error if a required choice can't be defaulted. Honored in CI environments automatically. |
| `CI` | Standard CI flag. Same effect as `IGNOREKIT_NONINTERACTIVE` — avoid interactive prompts. |

## Development

```bash
npm run test:unit         # run unit tests
npm run validate:situations  # validate situation files
npm test                  # both
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.
