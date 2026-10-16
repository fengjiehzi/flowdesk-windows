$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../src/SmartDeskBox.Intelligence/LlmSettings.cs') -Raw
# Compile the real loader with in-memory storage and credentials; never access user secrets or the network.
$source = $source.Replace('namespace SmartDeskBox.Intelligence;', 'namespace SmartDeskBox.Intelligence {') + "`n}"
$stubs = @'
namespace SmartDeskBox.Core { public sealed class WorkspacePaths { public string Root => "unused"; } }
namespace SmartDeskBox.Intelligence {
    public static class CredentialVault {
        public static string? Secret;
        public static string? Read(SmartDeskBox.Core.WorkspacePaths paths, string url) => Secret;
    }
    public static class File {
        public static string Configuration = "{}";
        public static bool Exists(string path) => path.EndsWith("appsettings.local.json");
        public static string ReadAllText(string path) => Configuration;
    }
}
'@
Add-Type -TypeDefinition ("#nullable enable`nusing System;`nusing System.IO;`n" + $source + "`n" + $stubs)
$variables = @('OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY')
$original = @{}
foreach ($name in $variables) { $original[$name] = [Environment]::GetEnvironmentVariable($name) }
try {
    $env:OPENAI_API_KEY = 'fake-openai'
    $env:DEEPSEEK_API_KEY = 'fake-deepseek'
    $env:GEMINI_API_KEY = 'fake-gemini'
    $cases = @(
        @('https://other-provider.example/v1', ''),
        @('https://api.openai.com.attacker.example/v1', ''),
        @('http://localhost:11434/v1', ''),
        @('https://api.openai.com/v1', 'fake-openai'),
        @('https://api.openai.com/v1/', 'fake-openai'),
        @('https://api.deepseek.com/v1', 'fake-deepseek'),
        @('https://generativelanguage.googleapis.com/v1beta/openai', 'fake-gemini')
    )
    foreach ($case in $cases) {
        [SmartDeskBox.Intelligence.File]::Configuration = @{ Enabled = $true; BaseUrl = $case[0]; Model = 'configured-model'; LlmApiKey = '' } | ConvertTo-Json -Compress
        $loaded = [SmartDeskBox.Intelligence.LlmSettings]::Load([SmartDeskBox.Core.WorkspacePaths]::new())
        if ($loaded.LlmApiKey -ne $case[1] -or $loaded.BaseUrl -ne $case[0] -or $loaded.Model -ne 'configured-model') { throw "Credential binding failed: $($case[0])" }
    }
    [SmartDeskBox.Intelligence.CredentialVault]::Secret = 'fake-vault'
    $loaded = [SmartDeskBox.Intelligence.LlmSettings]::Load([SmartDeskBox.Core.WorkspacePaths]::new())
    if ($loaded.LlmApiKey -ne 'fake-vault') { throw 'Stored credential precedence failed.' }
    [SmartDeskBox.Intelligence.File]::Configuration = '{"BaseUrl":"https://api.openai.com/v1","LlmApiKey":"fake-explicit"}'
    $loaded = [SmartDeskBox.Intelligence.LlmSettings]::Load([SmartDeskBox.Core.WorkspacePaths]::new())
    if ($loaded.LlmApiKey -ne 'fake-explicit') { throw 'Explicit credential precedence failed.' }
    Write-Host 'PASS LlmSettings: 9 credential binding scenarios; no files, user credentials or network accessed.'
} finally {
    foreach ($name in $variables) { [Environment]::SetEnvironmentVariable($name, $original[$name]) }
}
