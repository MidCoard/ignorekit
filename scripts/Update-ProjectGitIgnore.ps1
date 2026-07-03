[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectName,

    [string]$Root
)

. "$PSScriptRoot\GitIgnoreLib.ps1"

$project = Find-GisProject -ProjectName $ProjectName -Root $Root
$projectPath = [string]$project.path
if (-not (Test-Path $projectPath)) {
    throw "Project path does not exist: $projectPath"
}

$targetPath = Join-Path $projectPath '.gitignore'
$content = New-GisContent -Project $project

if ($PSCmdlet.ShouldProcess($targetPath, 'Update .gitignore from gitignore-standards')) {
    Write-GisText -Path $targetPath -Content $content
    Write-Host "Updated $targetPath"
}

