using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace SmartDeskBox.Core;

public enum AppCategory
{
    DEV_TOOLS, OFFICE_WORK, SOCIAL_IM, CREATIVE_MEDIA, GAMES, SYS_UTILITY, DOC_ASSETS, TEMP_INSTALL,
    AI_CODING, AI_ASSISTANT, FILE_UTILITY, NETWORK_REMOTE, MEDIA_ASSETS, FOLDERS, OTHER_FILES, BROWSERS, PENDING
}

public sealed record CategoryInfo(AppCategory Category, string Name, string Color, string Glyph, bool IsFile = false)
{
    public string GroupLabel => IsFile ? "文件" : "应用";
}

public static class Categories
{
    public static IReadOnlyList<CategoryInfo> All { get; } =
    [
        new(AppCategory.AI_CODING, "AI 编程", "#8B9FFF", "⌘"),
        new(AppCategory.AI_ASSISTANT, "AI 助手", "#B5A1E5", "✦"),
        new(AppCategory.DEV_TOOLS, "开发与编程", "#3B82F6", "⌘"),
        new(AppCategory.OFFICE_WORK, "办公与效率", "#10B981", "▤"),
        new(AppCategory.BROWSERS, "浏览器", "#7FAEC8", "◉"),
        new(AppCategory.SOCIAL_IM, "社交与通讯", "#06B6D4", "◉"),
        new(AppCategory.CREATIVE_MEDIA, "设计与影音", "#8B5CF6", "◈"),
        new(AppCategory.GAMES, "游戏娱乐", "#F59E0B", "✦"),
        new(AppCategory.FILE_UTILITY, "文件管理与搜索", "#8BAFA1", "⌕"),
        new(AppCategory.NETWORK_REMOTE, "网络与远程", "#7FAEC8", "⇄"),
        new(AppCategory.SYS_UTILITY, "系统工具", "#94A3B8", "⚙"),
        new(AppCategory.PENDING, "待确认应用", "#D4B47F", "?"),
        new(AppCategory.DOC_ASSETS, "文档资料", "#A8C5B4", "▤", true),
        new(AppCategory.MEDIA_ASSETS, "图片与影音文件", "#C9ABCA", "▧", true),
        new(AppCategory.FOLDERS, "文件夹", "#D5BC8A", "▣", true),
        new(AppCategory.TEMP_INSTALL, "安装包与归档", "#C7A18D", "↓", true),
        new(AppCategory.OTHER_FILES, "脚本、链接与其他", "#A9B7C2", "◇", true)
    ];

    public static CategoryInfo Get(AppCategory category) => All.Single(x => x.Category == category);
}

public sealed record DesktopItemMetadata
{
    public required string ItemId { get; init; }
    public required string SourceFilePath { get; init; }
    public required string FileName { get; init; }
    public required string DisplayName { get; init; }
    public required string Extension { get; init; }
    public bool IsPublicDesktop { get; init; }
    public bool IsDirectory { get; init; }
    public string? TargetPath { get; init; }
    public string? Arguments { get; init; }
    public string? WorkingDirectory { get; init; }
    public string? ShortcutComment { get; init; }
    public string? ProductName { get; init; }
    public string? FileDescription { get; init; }
    public string? CompanyName { get; init; }
    public string? ParentDirName { get; init; }
    public bool IsGameProtocolOrEngine { get; init; }
    public bool IsInstallerPackage { get; init; }

    public static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    public string SignatureHash => Hash((TargetPath ?? SourceFilePath).ToLowerInvariant() + "|" + (ProductName ?? ""));
}

public sealed record ClassificationResult(string ItemId, string SignatureHash, AppCategory Category,
    double Confidence, string HitTier, string PurposeSummary);
public sealed record ClassifiedItem(DesktopItemMetadata Metadata, ClassificationResult Result);
public sealed record BoxLayoutState(AppCategory Category, string MonitorId, double XRatio, double YRatio,
    double WidthRatio, double HeightRatio, bool IsCollapsed);
public sealed record FileTransaction(long TxId, string BatchId, string ItemName, string SourcePath,
    string DestinationPath, AppCategory Category, string OperationMode, string Status,
    long CreatedUnixSec, string BackupPath, string ContentHash);
public sealed record OrganizeReport(string BatchId, int CopiedCount, int PlaceholderCount, string SandboxPath);
public sealed record RollbackReport(string? BatchId, int RemovedCount);

[JsonSourceGenerationOptions(WriteIndented = true, UseStringEnumConverter = true)]
[JsonSerializable(typeof(List<ClassifiedItem>))]
[JsonSerializable(typeof(DesktopItemMetadata))]
public partial class AppJsonContext : JsonSerializerContext;
