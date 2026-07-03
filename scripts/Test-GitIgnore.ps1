param(
    [string]$ProjectName,
    [string]$Root,
    [switch]$All,
    [switch]$Detailed
)

. "$PSScriptRoot\GitIgnoreLib.ps1"

function Test-OneGitIgnore {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Project
    )

    $actualPath = Join-Path $Project.path '.gitignore'
    $expectedContent = Normalize-GisContent -Content (New-GisContent -Project $Project)

    if (-not (Test-Path $actualPath)) {
        $generatedPath = Write-GisRecommendation -Project $Project
        Write-Host "MISSING $($Project.root)/$($Project.name): $actualPath"
        Write-Host "  Recommendation: $generatedPath"
        return $false
    }

    $actualContent = Normalize-GisContent -Content (Read-GisText -Path $actualPath)
    if ($actualContent -eq $expectedContent) {
        Write-Host "OK $($Project.root)/$($Project.name)"
        return $true
    }

    $generatedPath = Write-GisRecommendation -Project $Project
    Write-Host "DIFF $($Project.root)/$($Project.name)"
    Write-Host "  Actual:         $actualPath"
    Write-Host "  Recommendation: $generatedPath"

    if ($Detailed -and (Get-Command git -ErrorAction SilentlyContinue)) {
        git diff --no-index -- "$actualPath" "$generatedPath"
    }

    return $false
}

if ($All) {
    $failures = 0
    foreach ($project in (Get-GisProjects)) {
        if (-not (Test-OneGitIgnore -Project $project)) {
            $failures++
        }
    }

    if ($failures -gt 0) {
        Write-Error "$failures project(s) differ from the standard."
        exit 1
    }

    Write-Host 'All project .gitignore files match the standard.'
    exit 0
}

if (-not [string]::IsNullOrWhiteSpace($ProjectName)) {
    $project = Find-GisProject -ProjectName $ProjectName -Root $Root
    if (Test-OneGitIgnore -Project $project) {
        exit 0
    }
    exit 1
}

Write-Error "Use -All or -ProjectName."
exit 1

