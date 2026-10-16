using System.Text.Json;
using SmartDeskBox.Core;

namespace SmartDeskBox.Intelligence;

public sealed record LlmSettings
{
    public bool Enabled { get; init; }
    public string LlmApiKey { get; init; } = "";
    public string BaseUrl { get; init; } = "https://api.openai.com/v1";
    public string Model { get; init; } = "gpt-4o-mini";

    public static LlmSettings Load(WorkspacePaths paths)
    {
        var settings = new LlmSettings();
        foreach (var filename in new[] { "appsettings.json", "appsettings.local.json" })
        {
            var path = Path.Combine(paths.Root, filename);
            if (File.Exists(path)) settings = JsonSerializer.Deserialize<LlmSettings>(File.ReadAllText(path)) ?? settings;
        }
        if (!string.IsNullOrWhiteSpace(settings.LlmApiKey)) return settings;
        var stored = CredentialVault.Read(paths, settings.BaseUrl);
        if (!string.IsNullOrEmpty(stored)) return settings with { LlmApiKey = stored };
        // Never send one provider's environment credential to another endpoint.
        var variable = settings.BaseUrl.TrimEnd('/') switch
        {
            "https://api.openai.com/v1" => "OPENAI_API_KEY",
            "https://api.deepseek.com/v1" => "DEEPSEEK_API_KEY",
            "https://generativelanguage.googleapis.com/v1beta/openai" => "GEMINI_API_KEY",
            _ => null
        };
        var key = variable is null ? null : Environment.GetEnvironmentVariable(variable);
        return string.IsNullOrWhiteSpace(key) ? settings : settings with { LlmApiKey = key };
    }

    public void Validate()
    {
        if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback)))
            throw new ArgumentException("BaseUrl 必须为 HTTPS，或本机 HTTP 地址。");
        if (string.IsNullOrWhiteSpace(Model)) throw new ArgumentException("请填写模型名称。");
    }
}
