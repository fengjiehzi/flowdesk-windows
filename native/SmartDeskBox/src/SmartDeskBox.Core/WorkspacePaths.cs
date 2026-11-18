namespace SmartDeskBox.Core;

public sealed class WorkspacePaths
{
    public string Root { get; }
    public string DatabasePath => Path.Combine(Root, "data", "smartdeskbox.db");
    public string SandboxRoot => Path.Combine(Root, "Sandbox_Desktop");
    public string ReportPath => Path.Combine(Root, "desktop_classification_report.json");

    public WorkspacePaths(string root)
    {
        Root = Path.GetFullPath(root);
        foreach (var desktop in RealDesktops())
            if (IsWithin(Root, desktop))
                throw new InvalidOperationException("工作区不能位于真实桌面目录中。");
        if (Directory.Exists(Root) && (File.GetAttributes(Root) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("拒绝通过符号链接或目录联接写入：" + Root);
    }

    public static WorkspacePaths Discover()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Environment.CurrentDirectory })
            for (var directory = new DirectoryInfo(start); directory != null; directory = directory.Parent)
                if (File.Exists(Path.Combine(directory.FullName, "SmartDeskBox.sln")))
                    return new WorkspacePaths(directory.FullName);
        return new WorkspacePaths(AppContext.BaseDirectory);
    }

    public static IEnumerable<string> RealDesktops() => new[]
    {
        Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Desktop"),
        Path.Combine(Environment.GetEnvironmentVariable("PUBLIC") ??
            Path.Combine(Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile))!, "Users", "Public"), "Desktop")
    }.Where(x => !string.IsNullOrWhiteSpace(x)).Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase);

    public static bool IsWithin(string path, string root)
    {
        path = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
        root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        return path.Equals(root, StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    public static void EnsureNoReparsePoints(string path, string? stopAt = null)
    {
        var boundary = stopAt is null ? null : Path.GetFullPath(stopAt).TrimEnd(Path.DirectorySeparatorChar);
        for (var current = new DirectoryInfo(Path.GetFullPath(path)); current != null; current = current.Parent)
        {
            var full = current.FullName.TrimEnd(Path.DirectorySeparatorChar);
            if ((current.Exists || File.Exists(current.FullName)) &&
                (File.GetAttributes(current.FullName) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("拒绝通过符号链接或目录联接写入：" + current.FullName);
            if (boundary != null && full.Equals(boundary, StringComparison.OrdinalIgnoreCase)) break;
            if (boundary is null) break;
        }
    }

    public string RequireSandboxPath(string path)
    {
        var full = Path.GetFullPath(path);
        if (!IsWithin(full, SandboxRoot) || full.Equals(SandboxRoot, StringComparison.OrdinalIgnoreCase) ||
            RealDesktops().Any(d => IsWithin(full, d)))
            throw new InvalidOperationException("操作路径越出沙盒边界：" + full);
        EnsureNoReparsePoints(full, SandboxRoot);
        return full;
    }
}
