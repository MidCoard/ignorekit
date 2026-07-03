# ignorekit Situations

This document defines the main situations `ignorekit` should handle. Each situation has a matching JSON file in `examples/situations/`.

## Situation Matrix

| ID | Workflow | Purpose | JSON |
| --- | --- | --- | --- |
| `init-java-gradle-git` | `init` | New Java/Gradle project, ensure Git repo, generate `.gitignore` | `examples/situations/init-java-gradle-git.json` |
| `init-frontend-no-git` | `init` | New frontend project, generate `.gitignore`, do not initialize Git | `examples/situations/init-frontend-no-git.json` |
| `init-existing-git` | `init` | Existing directory already has Git; `--git` skips `git init` | `examples/situations/init-existing-git.json` |
| `adopt-java-remove-cached` | `adopt` | Existing Java project, generate config, plan `git rm --cached` for tracked ignored files | `examples/situations/adopt-java-remove-cached.json` |
| `adopt-frontend-preview` | `adopt` | Existing frontend project, generate recommendation only, no apply addon | `examples/situations/adopt-frontend-preview.json` |
| `generate-pure` | `generate` | Pure generation from config; no addons allowed | `examples/situations/generate-pure.json` |
| `extract-component` | `extract` | Existing `.gitignore` becomes a reusable component draft | `examples/situations/extract-component.json` |
| `preset-create` | `preset-create` | Directly create a preset from base preset plus components | `examples/situations/preset-create.json` |
| `layered-workspace-override` | `generate` | Project uses workspace-level component override in addition to shipped preset | `examples/situations/layered-workspace-override.json` |

## JSON Shape

Every situation file has:

```json
{
  "version": 1,
  "id": "stable-id",
  "workflow": "init",
  "description": "Human-readable summary.",
  "command": "ignorekit init ...",
  "context": {},
  "config": {},
  "generation": {},
  "addons": [],
  "expected": {}
}
```

## Self-Matching Rules

The validator checks:

- `id` matches the file name.
- `workflow` is one of the known workflows.
- `config.preset` points to an existing preset when present.
- `config.components` and `config.localComponents` point to existing components when present.
- `init` and `adopt` situations enable generation.
- `generate` situations do not define workflow addons.
- `ensureGitRepo` addons only appear for `init` or `adopt`.
- `removeCachedIgnoredFiles` only appears for `adopt`.
- `extract` situations define `extract.output.kind`.
- `preset-create` situations define `presetDefinition.name` and `presetDefinition.components`.

Run:

```bash
npm run validate:situations
```

