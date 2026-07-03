# Gitignore Standards

This repository keeps `.gitignore` files consistent across local Java and frontend projects.

The policy is:

- Use the same section order everywhere.
- Compose each project from small stack-specific fragments.
- Keep project-specific runtime/data ignores explicit.
- Generate and verify ignores from a manifest instead of hand-sorting files in every repo.

## Project Roots

The analysis scripts look at these roots when they exist:

- `D:\IdeaProjects`
- `D:\WebstormProjects`
- `D:\WebStoreProjects`

`D:\WebStoreProjects` was not present when this repository was created. `D:\WebstormProjects` was present and appears to be the intended frontend root.

## Common Commands

Generate one recommendation:

```powershell
.\scripts\New-GitIgnore.ps1 -ProjectName veto
```

Generate every recommendation into `generated/`:

```powershell
.\scripts\New-GitIgnore.ps1 -All
```

Check one real project against its generated recommendation:

```powershell
.\scripts\Test-GitIgnore.ps1 -ProjectName veto
```

Check every project in the manifest:

```powershell
.\scripts\Test-GitIgnore.ps1 -All
```

Apply one generated `.gitignore` to a project after review:

```powershell
.\scripts\Update-ProjectGitIgnore.ps1 -ProjectName veto
```

Preview the apply operation:

```powershell
.\scripts\Update-ProjectGitIgnore.ps1 -ProjectName veto -WhatIf
```

## Profiles

- `generic-idea`: IDE-only or unknown project shape.
- `java-gradle`: Java/Kotlin projects using Gradle.
- `java-maven`: Java projects using Maven.
- `frontend-vite`: npm/Vite frontend projects.
- `scientific-artifacts`: MATLAB/research-style projects with local generated plots/data.

## Notes

Do not blindly ignore build wrappers:

- Keep `gradle/wrapper/gradle-wrapper.jar` trackable.
- Keep Maven wrapper files trackable unless a project intentionally does not use them.

Do not put personal editor or OS noise in every repo if it only affects one machine. Use a global Git excludes file for those when possible.
