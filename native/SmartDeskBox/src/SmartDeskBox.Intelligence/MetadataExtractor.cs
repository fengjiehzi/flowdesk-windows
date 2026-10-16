using System.Diagnostics;
using System.Runtime.InteropServices;
using SmartDeskBox.Core;

namespace SmartDeskBox.Intelligence;

public sealed record DesktopScan(List<DesktopItemMetadata> Items, List<string> Warnings);

public sealed class MetadataExtractor
{
    private static readonly string[] GameProtocols = ["steam://", "com.epicgames.launcher://", "wegame://", "uplay://", "battlenet://"];
    private static readonly string[] InstallerWords = ["setup", "install", "installer", "inno", "nullsoft", "nsis", "patch"];

    public DesktopScan ScanRealDesktop()
    {
        var items = new List<DesktopItemMetadata>();
        var warnings = new List<string>();
        var desktops = new[]
        {
            (Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), false),
            (Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory), true)
        };
        foreach (var (path, isPublic) in desktops.DistinctBy(x => x.Item1, StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(path)) continue;
            try
            {
                foreach (var source in Directory.GetFileSystemEntries(path))
                {
                    if (Path.GetFileName(source).Equals("desktop.ini", StringComparison.OrdinalIgnoreCase)) continue;
                    items.Add(Extract(source, isPublic, warnings));
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { warnings.Add($"无法完整读取 {path}：{ex.Message}"); }
        }
        return new(items.OrderBy(x => x.DisplayName, StringComparer.CurrentCultureIgnoreCase).ToList(), warnings);
    }

    public DesktopItemMetadata Extract(string source, bool isPublic = false, List<string>? warnings = null)
    {
        source = Path.GetFullPath(source);
        var extension = Path.GetExtension(source).ToLowerInvariant();
        var item = new DesktopItemMetadata
        {
            ItemId = DesktopItemMetadata.Hash(source.ToLowerInvariant()), SourceFilePath = source,
            FileName = Path.GetFileName(source), DisplayName = Path.GetFileNameWithoutExtension(source),
            Extension = extension, IsPublicDesktop = isPublic, IsDirectory = Directory.Exists(source),
            IsInstallerPackage = extension == ".exe" && InstallerWords.Any(word =>
                Path.GetFileName(source).Contains(word, StringComparison.OrdinalIgnoreCase))
        };
        try
        {
            if (extension == ".lnk") item = ReadShortcut(item);
            else if (extension == ".url")
            {
                var target = File.ReadLines(source).Select(l => l.Trim())
                    .FirstOrDefault(l => l.StartsWith("URL=", StringComparison.OrdinalIgnoreCase))?[4..].Trim();
                item = item with { TargetPath = target };
            }
            else if (extension == ".exe") item = item with { TargetPath = source };

            var targetPath = item.TargetPath;
            if (extension == ".lnk" && targetPath != null && (Directory.Exists(targetPath) ||
                (Path.IsPathFullyQualified(targetPath) && Path.GetExtension(targetPath).Length == 0)))
                item = item with { IsDirectory = true };
            var isGame = targetPath != null && GameProtocols.Any(p => targetPath.StartsWith(p, StringComparison.OrdinalIgnoreCase));
            if (targetPath != null && Path.IsPathFullyQualified(targetPath) &&
                Path.GetExtension(targetPath).Equals(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(targetPath))
            {
                var parent = Path.GetDirectoryName(targetPath)!;
                isGame |= new[] { "UnityPlayer.dll", "steam_api.dll", "steam_api64.dll", "GameAssembly.dll" }
                    .Any(name => File.Exists(Path.Combine(parent, name))) || Directory.Exists(Path.Combine(parent, "UnrealEngine"));
                item = item with { IsGameProtocolOrEngine = isGame };
                var version = FileVersionInfo.GetVersionInfo(targetPath);
                item = item with { ProductName = version.ProductName, FileDescription = version.FileDescription,
                    CompanyName = version.CompanyName, ParentDirName = new DirectoryInfo(parent).Name };
            }
            item = item with
            {
                IsGameProtocolOrEngine = isGame,
                IsInstallerPackage = extension == ".exe" && InstallerWords.Any(word =>
                    (item.FileName + " " + item.FileDescription).Contains(word, StringComparison.OrdinalIgnoreCase))
            };
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or COMException or
            System.ComponentModel.Win32Exception or ArgumentException or System.Reflection.TargetInvocationException or
            Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
        { warnings?.Add($"{item.FileName} 部分特征未读取：{ex.Message}"); }
        return item;
    }

    private static DesktopItemMetadata ReadShortcut(DesktopItemMetadata item)
    {
        object? shell = null;
        object? shortcut = null;
        try
        {
            var type = Type.GetTypeFromProgID("WScript.Shell");
            if (type == null) return item;
            shell = Activator.CreateInstance(type);
            if (shell == null) return item;
            shortcut = ((dynamic)shell).CreateShortcut(item.SourceFilePath);
            return item with
            {
                TargetPath = NullIfEmpty((string)((dynamic)shortcut).TargetPath),
                Arguments = NullIfEmpty((string)((dynamic)shortcut).Arguments),
                WorkingDirectory = NullIfEmpty((string)((dynamic)shortcut).WorkingDirectory),
                ShortcutComment = NullIfEmpty((string)((dynamic)shortcut).Description)
            };
        }
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
