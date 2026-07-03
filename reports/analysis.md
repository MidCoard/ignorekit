# Project Analysis

Created: 2026-07-03

## Roots

- `D:\IdeaProjects`: present
- `D:\WebstormProjects`: present
- `D:\WebStoreProjects`: not present

`D:\WebstormProjects` was used as the frontend root because it exists and contains WebStorm-style frontend projects.

## Profile Assignments

- `java-gradle`: 7 projects
  - `AIEnv`
  - `focess-api`
  - `focess_top_backend`
  - `keystead`
  - `keystead-client`
  - `keystead-server`
  - `veto`
- `java-maven`: 3 projects
  - `FocessCommand`
  - `FocessQQ`
  - `FocessScheduler`
- `frontend-vite`: 5 projects
  - `focess_api_backend`
  - `focess_top_frontend`
  - `postgenerator`
  - `untitled`
  - `veto-ui`
- `scientific-artifacts`: 3 projects
  - `jamming`
  - `RadarCorrection`
  - `RadarCorrection2`
- `generic-idea`: 5 projects
  - `AFSIMDoc`
  - `code`
  - `Docs`
  - `Radar`
  - `untitled`

## Missing Root Gitignore Files

These projects did not have a root `.gitignore` at analysis time:

- `D:\IdeaProjects\code`
- `D:\IdeaProjects\Docs`
- `D:\IdeaProjects\Radar`
- `D:\WebstormProjects\untitled`

## Cleanups Built Into The Standard

The generated recommendations intentionally avoid several risky existing patterns:

- Avoid ignoring the whole `gradle/` folder. The Gradle wrapper jar should remain trackable.
- Avoid ignoring the whole `.mvn/` folder. Maven wrapper files should remain trackable if a project uses them.
- Avoid ignoring every Markdown file with `*.md`; only known local docs scratchpads are project-specific.
- Keep frontend lockfiles trackable. Dependency folders are ignored, but lockfiles are source.

## Generated Recommendations

Recommendations are written under:

- `generated\IdeaProjects\*.gitignore`
- `generated\WebstormProjects\*.gitignore`

No real project `.gitignore` was overwritten during setup.

