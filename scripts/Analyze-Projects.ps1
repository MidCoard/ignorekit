param(
    [string[]]$Roots = @('D:\IdeaProjects', 'D:\WebstormProjects', 'D:\WebStoreProjects'),
    [string]$OutputDir
)

. "$PSScriptRoot\GitIgnoreLib.ps1"

function Test-AnyPath {
    param(
        [string]$Base,
        [string[]]$Names
    )

    foreach ($name in $Names) {
        if (Test-Path (Join-Path $Base $name)) {
            return $true
        }
    }
    return $false
}

function Get-DetectedProfile {
    param(
        [string]$Path
    )

    if (Test-AnyPath $Path @('package.json')) {
        return 'frontend-vite'
    }
    if (Test-AnyPath $Path @('build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew', 'gradlew.bat')) {
        return 'java-gradle'
    }
    if (Test-AnyPath $Path @('pom.xml')) {
        return 'java-maven'
    }
    return 'generic-idea'
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path (Get-GisRoot) 'reports'
}

$rows = foreach ($rootPath in $Roots) {
    if (-not (Test-Path $rootPath)) {
        continue
    }

    Get-ChildItem -Force $rootPath -Directory | Where-Object { $_.Name -ne 'gitignore-standards' } | ForEach-Object {
        $path = $_.FullName
        [pscustomobject]@{
            root = Split-Path $rootPath -Leaf
            name = $_.Name
            path = $path
            profile = Get-DetectedProfile -Path $path
            isGitRepo = Test-Path (Join-Path $path '.git')
            hasGitignore = Test-Path (Join-Path $path '.gitignore')
            hasPom = Test-Path (Join-Path $path 'pom.xml')
            hasGradle = Test-AnyPath $path @('build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew', 'gradlew.bat')
            hasPackageJson = Test-Path (Join-Path $path 'package.json')
            hasVite = Test-AnyPath $path @('vite.config.ts', 'vite.config.js', 'vite.config.mts')
            hasNext = Test-AnyPath $path @('next.config.js', 'next.config.mjs', 'next.config.ts')
            hasNuxt = Test-AnyPath $path @('nuxt.config.ts', 'nuxt.config.js')
            hasIdea = Test-Path (Join-Path $path '.idea')
            hasVSCode = Test-Path (Join-Path $path '.vscode')
        }
    }
}

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force $OutputDir | Out-Null
}

$jsonPath = Join-Path $OutputDir 'project-inventory.json'
$csvPath = Join-Path $OutputDir 'project-inventory.csv'

$json = $rows | ConvertTo-Json -Depth 5
Write-GisText -Path $jsonPath -Content ($json + "`n")
$rows | Export-Csv -NoTypeInformation -Path $csvPath

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $csvPath"

