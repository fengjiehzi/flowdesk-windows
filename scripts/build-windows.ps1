param(
  [ValidateSet('Dev', 'Release')]
  [string]$Mode = 'Dev',
  [switch]$Register
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$generatedRoot = Join-Path $projectRoot 'build\generated'
$nativeOutput = Join-Path $generatedRoot 'native'
$identityStage = Join-Path $generatedRoot 'identity-stage'
$identityOutput = Join-Path $generatedRoot 'identity'
$packageJson = Get-Content (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$versionParts = @($packageJson.version.Split('.'))
while ($versionParts.Count -lt 4) { $versionParts += '0' }
$packageVersion = ($versionParts[0..3] -join '.')
$packageName = if ($Mode -eq 'Release') { 'WindowsDynamicIsland' } else { 'WindowsDynamicIsland.Dev' }
$executable = if ($Mode -eq 'Release') { 'resources\native\NotificationBridge.exe' } else { 'build\generated\native\NotificationBridge.exe' }

New-Item -ItemType Directory -Force -Path $generatedRoot, $nativeOutput, $identityStage, $identityOutput | Out-Null

$certificatePath = $null
$certificatePassword = $null
if ($Mode -eq 'Release') {
  if (-not $env:WIN_CSC_LINK -or -not $env:WIN_CSC_KEY_PASSWORD) {
    throw 'Release build requires WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD.'
  }
  $certificatePassword = $env:WIN_CSC_KEY_PASSWORD
  if (Test-Path -LiteralPath $env:WIN_CSC_LINK) {
    $certificatePath = (Resolve-Path -LiteralPath $env:WIN_CSC_LINK).Path
  } else {
    $certificatePath = Join-Path $generatedRoot 'release-certificate.pfx'
    if ([Uri]::IsWellFormedUriString($env:WIN_CSC_LINK, [UriKind]::Absolute)) {
      Invoke-WebRequest -Uri $env:WIN_CSC_LINK -OutFile $certificatePath
    } else {
      [IO.File]::WriteAllBytes($certificatePath, [Convert]::FromBase64String($env:WIN_CSC_LINK))
    }
  }
} else {
  $certificatePassword = 'windows-dynamic-island-dev'
  $certificatePath = Join-Path $generatedRoot 'dev-certificate.pfx'
  $certificate = Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq 'CN=WindowsDynamicIsland Dev' | Select-Object -First 1
  if (-not $certificate) {
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=WindowsDynamicIsland Dev' -FriendlyName 'Windows Dynamic Island Dev' -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy Exportable -KeySpec Signature -HashAlgorithm SHA256
  }
  $securePassword = ConvertTo-SecureString $certificatePassword -AsPlainText -Force
  Export-PfxCertificate -Cert $certificate -FilePath $certificatePath -Password $securePassword -Force | Out-Null
  $publicCertificate = Join-Path $generatedRoot 'dev-certificate.cer'
  Export-Certificate -Cert $certificate -FilePath $publicCertificate -Force | Out-Null
  Import-Certificate -FilePath $publicCertificate -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
  # Windows 10 AppX deployment validates development packages against the machine TrustedPeople store.
  & certutil.exe -user -addstore -f TrustedPeople $publicCertificate | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Development certificate trust failed.' }
}

$signingCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath, $certificatePassword)
$publisher = $signingCertificate.Subject
$publisherXml = [Security.SecurityElement]::Escape($publisher)

$bridgeManifest = (Get-Content (Join-Path $projectRoot 'build\identity\NotificationBridge.manifest.template') -Raw -Encoding UTF8).
  Replace('{{PUBLISHER}}', $publisherXml).
  Replace('{{PACKAGE_NAME}}', $packageName)
$bridgeManifestPath = Join-Path $generatedRoot 'NotificationBridge.manifest'
[IO.File]::WriteAllText($bridgeManifestPath, $bridgeManifest, [Text.UTF8Encoding]::new($false))

dotnet publish (Join-Path $projectRoot 'native\NotificationBridge\NotificationBridge.csproj') -c Release -o $nativeOutput -p:ApplicationManifest=$bridgeManifestPath
if ($LASTEXITCODE -ne 0) { throw 'NotificationBridge publish failed.' }

$packageManifest = (Get-Content (Join-Path $projectRoot 'build\identity\Package.appxmanifest.template') -Raw -Encoding UTF8).
  Replace('{{PUBLISHER}}', $publisherXml).
  Replace('{{PACKAGE_NAME}}', $packageName).
  Replace('{{VERSION}}', $packageVersion).
  Replace('{{EXECUTABLE}}', $executable)
[IO.File]::WriteAllText((Join-Path $identityStage 'AppxManifest.xml'), $packageManifest, [Text.UTF8Encoding]::new($false))

$sdkBin = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory |
  Sort-Object Name -Descending |
  Where-Object { Test-Path (Join-Path $_.FullName 'x64\makeappx.exe') } |
  Select-Object -First 1
if (-not $sdkBin) { throw 'Windows SDK makeappx.exe/signtool.exe not found.' }
$makeAppx = Join-Path $sdkBin.FullName 'x64\makeappx.exe'
$signTool = Join-Path $sdkBin.FullName 'x64\signtool.exe'
$msixName = if ($Mode -eq 'Release') { 'WindowsDynamicIsland.Identity.msix' } else { 'WindowsDynamicIsland.Dev.Identity.msix' }
$msixPath = Join-Path $identityOutput $msixName
$timestampArguments = if ($Mode -eq 'Release') { @('/tr', 'http://timestamp.digicert.com', '/td', 'SHA256') } else { @() }

& $signTool sign /fd SHA256 @timestampArguments /f $certificatePath /p $certificatePassword (Join-Path $nativeOutput 'NotificationBridge.exe')
if ($LASTEXITCODE -ne 0) { throw 'NotificationBridge signing failed.' }
& $makeAppx pack /o /nv /d $identityStage /p $msixPath
if ($LASTEXITCODE -ne 0) { throw 'Sparse MSIX creation failed.' }
& $signTool sign /fd SHA256 @timestampArguments /f $certificatePath /p $certificatePassword $msixPath
if ($LASTEXITCODE -ne 0) { throw 'Sparse MSIX signing failed.' }

if ($Register) {
  $registerCommand = "`$ErrorActionPreference='Stop'; Get-AppxPackage -Name '$packageName' | Remove-AppxPackage -ErrorAction SilentlyContinue; Add-AppxPackage -Path '$msixPath' -ExternalLocation '$projectRoot'"
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $registerCommand
  if ($LASTEXITCODE -ne 0) { throw 'Sparse MSIX registration failed.' }
}

Write-Host "Windows notification assets ready: $Mode"
