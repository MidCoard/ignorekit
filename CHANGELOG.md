# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-24

First stable release.

### Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize a new project with `ignorekit.json` config and `.gitignore` |
| `adopt` | Bring an existing project into ignorekit — analyzes `.gitignore`, picks preset, carries custom rules |
| `generate` | Build `.gitignore` from a project config |
| `explain` | Show what each component in a config contributes (like `EXPLAIN` in SQL) |
| `analyze` | Reverse-engineer a `.gitignore` — match lines against known components, suggest presets |
| `search` | Find components containing a rule pattern (case-insensitive) |
| `list` | Browse available components and presets |
| `create` | Create reusable component or preset definitions |
| `remove` | Remove a user-defined component or preset |

### Core features

- **3-layer definition system** — dist (shipped), user (`~/.ignorekit`), workspace (`--workspace-root`). Higher layers override lower. User and workspace definitions are picked up automatically.
- **Composable components** — atomic ignore rule sets identified by `category/name` (e.g. `language/java`, `platform/macos`, `build/gradle`).
- **Preset inheritance** — presets extend other presets via a `base` field. `django` extends `python` extends `generic`. The full chain is resolved automatically with deduplication and circular-inheritance detection.
- **Bracket expression expansion** — `*.py[cod]` matches `*.pyc`, `[Dd]esktop.ini` matches `Desktop.ini`. Used in adopt's custom-rule carry-forward and analysis matching.
- **Smart rule extraction** — `create component --from .gitignore` analyzes the source against known components and extracts only unmatched rules. Covered rules are pre-deselected in the interactive toggle.
- **Interactive rule toggle** — guided creation shows every candidate rule with `[x]`/`[ ]` markers; toggle by number, range, `all`, or `none`.
- **CI / non-interactive mode** — `CI` or `IGNOREKIT_NONINTERACTIVE` environment variables skip all interactive prompts. `--confirm` flag skips overwrite prompts on `generate` and `adopt`.
- **Dry run** — `--dry-run` on `init`, `adopt`, `generate`, `create`, and `remove` previews output without writing files or changing Git state.
- **Project config** (`ignorekit.json`) — declares `preset`, `components`, `exclude`, and `custom` rules. Same config always produces the same `.gitignore`.
- **Git integration** — `init --git` initializes a repository; `adopt --remove-cached` and `generate --remove-cached` remove newly-ignored files from the Git index.

### Shipped definitions

**37 components** across 10 categories:

| Category | Components |
|----------|-----------|
| Platform | `macos`, `windows` |
| Editor | `jetbrains`, `vscode`, `temporary-files`, `java-ide-metadata` |
| Language | `java`, `node`, `python`, `rust`, `go`, `ruby`, `php`, `c-cpp` |
| Build | `gradle`, `maven`, `cmake` |
| Package | `pip`, `poetry`, `pnpm`, `yarn` |
| Framework | `vite`, `next`, `nuxt`, `angular`, `sveltekit`, `django`, `flask` |
| Testing | `browser-e2e` |
| Domain | `scientific-artifacts` |
| Local | `env-secrets`, `logs`, `assistant-artifacts` |
| AI tools | `ai-claude`, `ai-gemini`, `ai-codex`, `ai-codegraph` |

**25 presets** with inheritance chains:

`generic`, `blank`, `node`, `node-pnpm`, `node-yarn`, `vite`, `next`, `nuxt`, `sveltekit`, `angular`, `java`, `java-gradle`, `java-maven`, `python`, `python-poetry`, `django`, `flask`, `rust`, `go`, `ruby`, `php`, `c`, `cpp`, `cpp-cmake`, `scientific`.

### Design decisions

- Components are specificity-audited: generic patterns (`dist/`, `build/`, `coverage/`) are removed from language components and placed in their correct category. A component must not false-match projects outside its domain.
- Shipped definitions target public repositories: local editor workspaces, AI tool state, secrets, and machine-specific files are ignored by default.
- Environment secrets component ignores `.env.*` files while keeping `.env.example` and `.env.sample` available for version control.
- AI tool components are opt-in (not included in `generic` preset).
- `--dist-root` flag removed in favor of `IGNOREKIT_DIST_ROOT` environment variable.
- Zero runtime dependencies. Node.js >= 18.
