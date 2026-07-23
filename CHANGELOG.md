# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.18] - 2026-07-23

### Fixed
- Make `generate --dry-run` and `adopt --dry-run` strictly read-only previews.
- Prevent `adopt --remove-cached` from changing the Git index when `.gitignore` was not written.
- Preserve Git pattern syntax when analyzing and adopting `.gitignore` files.
- Make destructive remove prompts default to no, honor `--confirm`, and support user overrides and workspace roots.
- Reject unsupported command options and support `ignorekit <command> --help`.
- Align README command, component, and environment-variable documentation with the current CLI.
- Reject obsolete provider template fields and remove their no-op generation path.
- Calculate analysis coverage from unique source rules, preventing percentages above 100%.
- Make `--workspace-root` a create target, and add read-only `--dry-run` support to `init`, `create`, and `remove`.
- Reject whitespace-only and multi-line rules before they can create invalid definitions.

## [0.6.5] — 2026-07-14

### Fixed
- Add size guard for .gitignore and template responses
- Enhance error handling for invalid filenames
- Security hardening: credential redaction, error code system, TOCTOU fixes
- Eliminate TOCTOU gap in gitignore-io URL handling
- Improve EFILETOOLARGE handling in validate-situations

## [0.6.4] — 2026-07-13

### Fixed
- `chooseRulesSmart` fallback when analysis fails
- Adopt guard ordering: overwrite-config before analysis
- Signal handler cleanup
- Situation drift in validation

## [0.6.3] — 2026-07-12

### Fixed
- Environment variable documentation in README
- gitignore-io mock fixes in tests
- README env-var section accuracy

## [0.6.2] — 2026-07-11

### Fixed
- Data-loss prevention in test cleanup
- `--yes` flag in adopt workflow
- `--user-root` warning for create commands
- Piped stdin race condition
- `parseArgs` `--key=value` support
- CI escape hatch for non-interactive environments

## [0.6.1] — 2026-07-10

### Fixed
- `userRoot`/`outputRoot` separation in create commands
- Eliminate double-read of gitignore.io templates
- DRY resolver/prompt/format shared utilities

## [0.6.0] — 2026-07-09

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

## [0.5.0] — 2026-07-07

### Added
- `explain` and `analyze` commands
- Component matching and preset scoring
- Interactive creation prompts
- Project signal detection (package.json, build.gradle, etc.)

### Fixed
- Adopt carries custom rules from existing .gitignore
- Preset scoring uses completeness over raw count

## [0.4.0] — 2026-07-05

### Added
- Interactive preset picker with default path and blank preset
- Multiple .gitignore component files
- User-defined preset support

### Fixed
- Analyze matching accuracy
- AI tool component split

## [0.3.0] — 2026-07-03

### Added
- `extract` and `adopt` commands with analysis
- Preset scoring and suggestion

## [0.2.0] — 2026-07-01

### Added
- All core workflows: generate, init, adopt, extract, preset create
- CLI harness and help system
- Shipped components and presets

## [0.1.0] — 2026-06-28

### Added
- Initial gitignore standards and component definitions
- Project structure and situation definitions

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
