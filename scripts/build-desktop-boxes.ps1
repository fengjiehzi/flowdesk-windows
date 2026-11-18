param(
  [switch]$FrameworkDependent,
  [switch]$PreserveOutput
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectFile = Join-Path $projectRoot 'native\SmartDeskBox\src\SmartDeskBox.DesktopApp\SmartDeskBox.DesktopApp.csproj'
$outputPath = Join-Path $projectRoot 'build\generated\native'
$packagesPath = Join-Path $projectRoot 'build\generated\desktop-nuget'
$selfContained = if ($FrameworkDependent) { 'false' } else { 'true' }

if (-not $PreserveOutput -and (Test-Path -LiteralPath $outputPath)) {
  Remove-Item -LiteralPath $outputPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

dotnet publish $projectFile -c Release -r win-x64 --self-contained $selfContained -o $outputPath -p:NuGetAudit=false "-p:RestorePackagesPath=$packagesPath"
if ($LASTEXITCODE -ne 0) { throw 'Desktop boxes module publish failed.' }
Write-Host "Desktop boxes module ready (shared native runtime): $outputPath"
