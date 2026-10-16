using System.Text.Json;
using SmartDeskBox.Core;

namespace SmartDeskBox.DesktopApp;

public sealed record InterfaceSettings
{
    public string Theme { get; init; } = "System";
    public double TextSize { get; init; } = 13;
    public bool SnapEnabled { get; init; } = true;
    public bool LockLayout { get; init; }
    public bool HoverExpand { get; init; } = true;
    public bool DragExpand { get; init; } = true;
    public bool HideEmpty { get; init; } = true;
    public bool AutoRefresh { get; init; } = true;

    public static string FilePath(WorkspacePaths paths) => Path.Combine(paths.Root, "data", "interface-settings.json");
    public static InterfaceSettings Load(WorkspacePaths paths)
    {
        string path = FilePath(paths);
        var result = File.Exists(path) ? JsonSerializer.Deserialize<InterfaceSettings>(File.ReadAllText(path))
            ?? throw new JsonException("界面配置为空。") : new();
        result.Validate();
        return result;
    }
    public void Validate()
    {
        if (Theme is not ("System" or "Light" or "Dark")) throw new ArgumentException("请选择有效的界面主题。");
        if (!double.IsFinite(TextSize) || TextSize < 12 || TextSize > 18) throw new ArgumentException("文字大小必须介于 12 和 18 之间。");
    }
    public void Save(WorkspacePaths paths)
    {
        Validate();
        string path = FilePath(paths);
        WorkspacePaths.EnsureNoReparsePoints(path);
        WorkspacePaths.EnsureNoReparsePoints(path + ".tmp");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(path + ".tmp", path, true);
    }
}
