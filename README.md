# ignorekit

`ignorekit` is a small cross-platform tool for building `.gitignore` files from predefined ignore types.

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
  "root": "IdeaProjects",
  "name": "veto",
  "path": "D:\\IdeaProjects\\veto",
  "preset": "java-gradle",
  "custom": [
    "/vault/",
    "/audit/",
    "/models/",
    "*.gguf"
  ]
}
```

Project entries live in `projects.json`.

## Commands

List available components, presets, and projects:

```bash
node bin/ignorekit.js list
```

Generate one project recommendation into `generated/`:

```bash
node bin/ignorekit.js build veto --root IdeaProjects
```

Generate every project recommendation:

```bash
node bin/ignorekit.js build --all
```

Validate the situation examples:

```bash
npm run validate:situations
```

Check one real project `.gitignore` against the composed standard:

```bash
node bin/ignorekit.js check veto --root IdeaProjects
```

Show a diff:

```bash
node bin/ignorekit.js diff veto --root IdeaProjects
```

Preview apply:

```bash
node bin/ignorekit.js apply veto --root IdeaProjects
```

Apply after review:

```bash
node bin/ignorekit.js apply veto --root IdeaProjects --yes
```

If installed through npm later, the same commands become:

```bash
ignorekit list
ignorekit build veto --root IdeaProjects
ignorekit apply veto --root IdeaProjects --yes
```

## Project Roots

The current manifest includes projects from:

- `D:\IdeaProjects`
- `D:\WebstormProjects`
- `D:\WebStoreProjects`

`D:\WebStoreProjects` was not present when the first inventory was created. `D:\WebstormProjects` was present and contains the frontend projects.

## Legacy Scripts

The earlier PowerShell scripts are still present under `scripts/`, but `ignorekit` is now the primary tool because it is cross-platform and uses the component/preset model directly.

## Policy Notes

- Keep build wrappers trackable, especially `gradle/wrapper/gradle-wrapper.jar`.
- Keep frontend lockfiles trackable.
- Do not hide broad source categories like all Markdown files unless a project has an explicit local-only reason.
- Put personal machine/editor noise in a global Git excludes file when it does not belong to the team.
