param([switch]$FrameworkDependent)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectFile = Join-Path $projectRoot 'native\SmartDeskBox\src\SmartDeskBox.DesktopApp\SmartDeskBox.DesktopApp.csproj'
$outputPath = Join-Path $projectRoot 'build\generated\desktop-boxes'
$packagesPath = Join-Path $projectRoot 'build\generated\desktop-nuget'
$selfContained = if ($FrameworkDependent) { 'false' } else { 'true' }

dotnet publish $projectFile -c Release -r win-x64 --self-contained $selfContained -o $outputPath -p:NuGetAudit=false "-p:RestorePackagesPath=$packagesPath"
if ($LASTEXITCODE -ne 0) { throw 'Desktop boxes module publish failed.' }
Write-Host "Desktop boxes module ready: $outputPath"
