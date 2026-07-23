# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `ignorekit search <pattern>` — find components containing a rule pattern (case-insensitive substring match). E.g. `ignorekit search .DS_Store` shows `platform/macos`, `ignorekit search .env` shows `local/env-secrets`.
- Define shipped components as public-repository-safe defaults: ignore complete JetBrains, VS Code, Claude, Codex, and Gemini workspace directories instead of publishing tool configuration implicitly.

## [0.9.18] - 2026-07-23

### Added
- Bracket expression expansion in pattern matching: `*.py[cod]` now matches `*.pyc`, `[Dd]esktop.ini` matches `Desktop.ini` (`expandBrackets()`, `normalizePatternExpanded()` in `src/core/text.js`).
- `--confirm` flag for `generate` and `adopt` commands — skips the overwrite prompt in CI.
- `ignorekit generate` with no arguments defaults to `./ignorekit.json` in the current directory.
- `--dry-run` support for `init`, `create`, and `remove` commands.
- Reject unsupported command options and support `ignorekit <command> --help`.
- Reject whitespace-only and multi-line rules before they can create invalid definitions.
- Rebalance shipped components: remove duplicate preset rules, cover Vite and Angular build output, protect mode-specific environment files while retaining examples, and exclude private editor workspace state.
- Reject obsolete provider template fields and remove their no-op generation path.

### Changed
- **Component specificity audit** — all 37 shipped components audited and refined to prevent false matches across categories:
  - Merge `language/c` + `language/cpp` into `language/c-cpp` (no distinguishing patterns).
  - Expand `language/rust` with `**/*.rs.bk`, `rustc-ice-*.txt`, `**/mutants.out*/`, `cargo-timing-*.html`.
  - Expand `language/go` with `*.exe~`, `*.coverprofile`, `go.work`, `go.work.sum`.
  - Expand `language/php` with `composer.phar`, `.phpunit.result.cache`, `.phpactor.json`, `auth.json`, while keeping `composer.lock` versioned.
  - Keep generic patterns (`dist/`, `build/`, `coverage/`) out of `language/node` and `language/python`.
  - Trim `language/ruby` and `language/python` to keep match ratio above 0.3 threshold.
  - Move JVM crash logs (`hs_err_pid*`, `replay_pid*`) from `local/logs` to `language/java`.
  - Expand `build/cmake` with CMake-specific patterns (`CMakeCache.txt`, `CMakeFiles/`, `CMakeUserPresets.json`, `_deps/`).
  - Expand `build/maven` with `.mvn/timing.properties`, `.mvn/wrapper/maven-wrapper.jar`, `buildNumber.properties`.
  - Expand `build/gradle` with `gradle-app.setting`, `.gradletasknamecache`.
  - Clean up editor components — ignore complete `.idea/` and `.vscode/` workspace directories, and add `Session.vim`, `.netrwhist`, `*.vsix`, `.metadata/`.
  - Expand `package/pip` with `.installed.cfg`, `MANIFEST`, `pip-log.txt`, `.venv/`, `venv/`, `.pytest_cache/`, `.mypy_cache/`.
  - Expand `package/yarn` with Yarn v2+ patterns (`.yarn/*` with negations, `.yarn-integrity`, `.pnp.*`).
  - Change `package/pnpm` to `.pnpm-store/` (removed `pnpm-lock.yaml` — typically committed).
  - Change `package/poetry` to `poetry.toml` (removed `poetry.lock` — typically committed).
  - Trim `platform/macos` to core OS-specific patterns (`.DS_Store`, `._*`, `.AppleDouble`).
  - Trim `platform/windows` to core OS-specific patterns (`Thumbs.db`, `ehthumbs.db`, `Desktop.ini`, `$RECYCLE.BIN/`, `*.lnk`).
  - Add standard `dist/` output to `framework/angular` and `framework/vite`, plus `out-tsc/`, `.ng/`, `.vite/`.
  - Replace `webconfig.py` with `.webassets-cache` in `framework/flask`.
  - Expand `domain/scientific-artifacts` with `*.hdf5`, `*.npy`, `*.pkl`, `*.parquet`, `*.rds`, `*.nc`, `.ipynb_checkpoints`, `wandb/`, `mlruns/`, while keeping the `dvc/` source directory visible.
  - Expand `testing/browser-e2e` with `cypress/downloads/`, `blob-report/`, `playwright/.cache/`.
  - Remove duplicates (`.claude/`, `.codegraph/`) from `local/assistant-artifacts`.
  - Add `.envrc`, `*.jks`, `*.p12`, `*.pfx`, `.secrets` to `local/env-secrets`.
- **Adopt confirm flow redesign** — 3 separate steps instead of a single confirm:
  1. Ask to overwrite existing `ignorekit.json` (declining aborts the entire operation).
  2. Show/ask preview of the generated `.gitignore`.
  3. Ask to overwrite existing `.gitignore` only (new files are written without asking).
- `generate` only asks for confirmation when overwriting an existing `.gitignore` — creating a new file never prompts.
- `--workspace-root` is now a create target (not just a discovery source).
- Destructive `remove` prompts default to no, honor `--confirm`, and support user overrides and workspace roots.
- Calculate analysis coverage from unique source rules, preventing percentages above 100%.
- Make `generate --dry-run` and `adopt --dry-run` strictly read-only previews.
- Prevent `adopt --remove-cached` from changing the Git index when `.gitignore` was not written.
- Preserve Git pattern syntax when analyzing and adopting `.gitignore` files.
- Remove project-layer `.ignorekit/` support — 3 layers only (dist, user, workspace).
- Update environment handling and improve user prompts in workflows.
- Align README command, component, and environment-variable documentation with the current CLI.

### Fixed
- `*.pyc` now recognized as covered by `*.py[cod]` in adopt custom-rule dedup (bracket expansion).
- `Desktop.ini` now matches `[Dd]esktop.ini` in analysis (bracket expansion).
- `assertDefinitionId` rejects `/./` segments to prevent path-aliasing.
- `pickPresetInteractive` case-insensitive matching for preset names.
- Create component `category/name` syntax (infers `--category` from positional arg).
- `parseArgs` integrates repeatable options in single pass, eliminating dual-parse.
- `checkCircular` backtracking fix for diamond inheritance in presets.
- `readJsonOrNull` unconditional EACCES warning to stderr.
- `detectProjectSignals` EACCES guard on project directory.
- P0 `commandList` crash — missing `stderr` extraction.
- Adopt `exclude` filter applied before `coveredRules` computation (data loss fix).
- Adopt resolves zero-overlap component rules for `coveredRules` (duplication fix).
- Adopt warns when analysis fails and custom rules will be lost.
- Adopt uses `displayedUnmatchedLines` instead of `unmatchedLines` for display.
- `pickPresetInteractive` returns `safeDefault` when answer is null (CI failure fix).
- `findDefinition` size guard before `readFileSync` (memory exhaustion prevention).
- `readPreset` wraps `JSON.parse` with file path context.
- `resolvePresetComponents` deduplicates when no base preset.
- `buildCreateEnv`/`buildPickerEnv` delegate to `extractStreams` for consistency.
- `walkFiles` recursion depth limit (`MAX_WALK_DEPTH=20`).
- `readJson` preserves error cause chain (`wrapped.cause = error`).
- `explain` deduplicates `allComponents` with `Set`.
- `build-config` replaces fragile regex with `startsWith` checks.
- `normalizeStringArray` rejects empty/whitespace-only strings.
- `validate-situations` adds `config.exclude` validation.
- Memory exhaustion guard in `chooseRulesSmart` before `readFileSync`.
- Resolver `findDefinition` re-throws `EACCES` instead of masking as "not found".
- Generator warns on stderr for missing components instead of silent skip.
- Remove double normalization in `generateGitignore`.
- `listDefinitions` catches `EACCES` gracefully.
- TOCTOU gap eliminated in gitignore-io URL handling.
- `validate-situations` distinguishes `EFILETOOLARGE` from invalid JSON errors.
- Credentials redacted from all gitignore-io URL error paths.
- `readJsonOrNull` re-throws size-guard errors instead of silently returning null.
- `detectProjectSignals` degrades gracefully when `package.json` is too large.
- `checkSize` sets `err.code = 'EFILETOOLARGE'` for programmatic detection.
- `.env` detection pattern handles leading whitespace.
- Negation detection uses `trimStart().startsWith('!')` consistently.
- `normalizeProjectConfig` surfaces all validation errors at once.

## [0.6.6] - 2026-07-15

### Added
- `--version` flag (prints `ignorekit v0.6.6`).
- `--version` and `--help` listed in general help output.
- Category/name syntax docs in `create component` help.
- CHANGELOG.md with full release history (0.1.0–0.6.5).

### Changed
- Preview delimiters: `--- Preview (.gitignore) ---`.
- Generator header: `Generated by ignorekit v0.6.6` (version for traceability).
- Unified success messages: `Created component X → path`, `Created preset X → path`.
- Interactive prompt: `Category [local]:` with bracket-notation default.
- Component name prompt includes hint text.
- Improved description and keywords in `package.json` for npm discoverability.
- Add exports map to `package.json`.

### Fixed
- Init: `.gitignore already exists` instead of `Ignore file already exists`.
- Init: `Config already exists — use --overwrite to replace it`.
- Adopt: add path to `Generated .gitignore` success message.
- Adopt: suggest `ignorekit init` when project path doesn't exist.
- `assertDefinitionId` rejects `/./` segments to prevent path-aliasing.
- `pickPresetInteractive` case-insensitive matching for preset names.
- Create component `category/name` syntax (infers `--category` from positional arg).
- `parseArgs` integrates repeatable options in single pass, eliminating dual-parse.
- `checkCircular` backtracking fix for diamond inheritance in presets.
- `readJsonOrNull` unconditional EACCES warning to stderr.
- `detectProjectSignals` EACCES guard on project directory.
- P0 `commandList` crash — missing `stderr` extraction.
- Adopt `exclude` filter applied before `coveredRules` computation (data loss fix).
- Adopt resolves zero-overlap component rules for `coveredRules` (duplication fix).
- Adopt warns when analysis fails and custom rules will be lost.
- Adopt uses `displayedUnmatchedLines` instead of `unmatchedLines` for display.
- `pickPresetInteractive` returns `safeDefault` when answer is null (CI failure fix).
- `findDefinition` size guard before `readFileSync` (memory exhaustion prevention).
- `readPreset` wraps `JSON.parse` with file path context.
- `resolvePresetComponents` deduplicates when no base preset.
- `buildCreateEnv`/`buildPickerEnv` delegate to `extractStreams` for consistency.
- `walkFiles` recursion depth limit (`MAX_WALK_DEPTH=20`).
- `readJson` preserves error cause chain (`wrapped.cause = error`).
- `explain` deduplicates `allComponents` with `Set`.
- `build-config` replaces fragile regex with `startsWith` checks.
- `normalizeStringArray` rejects empty/whitespace-only strings.
- `validate-situations` adds `config.exclude` validation.
- Memory exhaustion guard in `chooseRulesSmart` before `readFileSync`.
- Resolver `findDefinition` re-throws `EACCES` instead of masking as "not found".
- Generator warns on stderr for missing components instead of silent skip.
- Remove double normalization in `generateGitignore`.
- `listDefinitions` catches `EACCES` gracefully.
- TOCTOU gap eliminated in gitignore-io URL handling.
- `validate-situations` distinguishes `EFILETOOLARGE` from invalid JSON errors.
- Credentials redacted from all gitignore-io URL error paths.
- `readJsonOrNull` re-throws size-guard errors instead of silently returning null.
- `detectProjectSignals` degrades gracefully when `package.json` is too large.
- `checkSize` sets `err.code = 'EFILETOOLARGE'` for programmatic detection.
- `.env` detection pattern handles leading whitespace.
- Negation detection uses `trimStart().startsWith('!')` consistently.
- `normalizeProjectConfig` surfaces all validation errors at once.

## [0.6.5] - 2026-07-14

### Fixed
- Add size guard for .gitignore and template responses
- Enhance error handling for invalid filenames
- Security hardening: credential redaction, error code system, TOCTOU fixes
- Eliminate TOCTOU gap in gitignore-io URL handling
- Improve EFILETOOLARGE handling in validate-situations

## [0.6.4] - 2026-07-13

### Fixed
- `chooseRulesSmart` fallback when analysis fails
- Adopt guard ordering: overwrite-config before analysis
- Signal handler cleanup
- Situation drift in validation

## [0.6.3] - 2026-07-12

### Fixed
- Environment variable documentation in README
- gitignore-io mock fixes in tests
- README env-var section accuracy

## [0.6.2] - 2026-07-11

### Fixed
- Data-loss prevention in test cleanup
- `--yes` flag in adopt workflow
- `--user-root` warning for create commands
- Piped stdin race condition
- `parseArgs` `--key=value` support
- CI escape hatch for non-interactive environments

## [0.6.1] - 2026-07-10

### Fixed
- `userRoot`/`outputRoot` separation in create commands
- Eliminate double-read of gitignore.io templates
- DRY resolver/prompt/format shared utilities

## [0.6.0] - 2026-07-09

### Added
- Simplified command surface: `init`, `adopt`, `generate`, `explain`, `analyze`, `list`, `create`
- Preview + confirm gate before writing files
- Per-rule toggle UI in interactive create
- Suggestion errors when analysis finds a better preset
- Default source path in interactive create
- `--exclude` flag to omit preset components
- `--yes` flag for non-interactive/CI usage

### Changed
- Renamed `extract` command to `create component`
- Renamed `preset create` to `create preset`
- Interactive preset picker with numbered selection and `g`/`b` shortcuts
- Adopt workflow shows analysis before preview

## [0.5.0] - 2026-07-07

### Added
- `explain` and `analyze` commands
- Component matching and preset scoring
- Interactive creation prompts
- Project signal detection (package.json, build.gradle, etc.)

### Fixed
- Adopt carries custom rules from existing .gitignore
- Preset scoring uses completeness over raw count

## [0.4.0] - 2026-07-05

### Added
- Interactive preset picker with default path and blank preset
- Multiple .gitignore component files
- User-defined preset support

### Fixed
- Analyze matching accuracy
- AI tool component split

## [0.3.0] - 2026-07-03

### Added
- `extract` and `adopt` commands with analysis
- Preset scoring and suggestion

## [0.2.0] - 2026-07-01

### Added
- All core workflows: generate, init, adopt, extract, preset create
- CLI harness and help system
- Shipped components and presets

## [0.1.0] - 2026-06-28

### Added
- Initial gitignore standards and component definitions
- Project structure and situation definitions

[0.9.18]: https://github.com/MidCoard/ignorekit/compare/v0.6.6...v0.9.18
[0.6.6]: https://github.com/MidCoard/ignorekit/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/MidCoard/ignorekit/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/MidCoard/ignorekit/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/MidCoard/ignorekit/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/MidCoard/ignorekit/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/MidCoard/ignorekit/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/MidCoard/ignorekit/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/MidCoard/ignorekit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/MidCoard/ignorekit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/MidCoard/ignorekit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MidCoard/ignorekit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/MidCoard/ignorekit/releases/tag/v0.1.0
