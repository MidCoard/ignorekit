param(
    [string]$ProjectName,
    [string]$Root,
    [string]$Profile,
    [string]$Output,
    [switch]$All
)

. "$PSScriptRoot\GitIgnoreLib.ps1"

if ($All) {
    foreach ($project in (Get-GisProjects)) {
        $path = Write-GisRecommendation -Project $project
        Write-Host "Generated $path"
    }
    exit 0
}

if (-not [string]::IsNullOrWhiteSpace($ProjectName)) {
    $project = Find-GisProject -ProjectName $ProjectName -Root $Root
    $path = Write-GisRecommendation -Project $project -Output $Output
    Write-Host "Generated $path"
    exit 0
}

if (-not [string]::IsNullOrWhiteSpace($Profile)) {
    $project = New-GisProfileProject -Profile $Profile
    $path = Write-GisRecommendation -Project $project -Output $Output
    Write-Host "Generated $path"
    exit 0
}

Write-Error "Use -All, -ProjectName, or -Profile."
exit 1

