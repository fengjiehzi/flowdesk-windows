$ErrorActionPreference = 'Stop'
$logPath = Join-Path $env:TEMP 'flowdesk-identity-install.log'

try {
  $installDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  $msixPath = Join-Path $PSScriptRoot 'WindowsDynamicIsland.Identity.msix'

  if (-not (Test-Path -LiteralPath $msixPath)) {
    throw "Identity package not found: $msixPath"
  }

  Get-AppxPackage -Name 'WindowsDynamicIsland' -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
  Add-AppxPackage -Path $msixPath -ExternalLocation $installDir
  if (Test-Path -LiteralPath $logPath) {
    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
  }
} catch {
  $_ | Out-String | Set-Content -LiteralPath $logPath -Encoding UTF8
  Write-Error $_
  exit 1
}
