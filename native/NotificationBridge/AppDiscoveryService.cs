using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace WindowsDynamicIsland.NotificationBridge;

internal static class AppDiscoveryService
{
    private static readonly Guid BhidEnumItems = new("94f60519-2850-4924-aa5a-d15e84868039");
    private static PropertyKey PkeyAppUserModelId = new(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);

    public static void WriteJson()
    {
        var items = Discover();
        Console.Out.WriteLine(JsonSerializer.Serialize(items));
        Console.Out.Flush();
    }

    public static List<object> Discover()
    {
        var items = new List<object>(128);
        DiscoverShortcuts(items);
        DiscoverAppsFolder(items);
        return items;
    }

    private static void DiscoverShortcuts(List<object> output)
    {
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)
        }
        .Where(p => !string.IsNullOrWhiteSpace(p) && Directory.Exists(p))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

        object? shell = null;
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is not null) shell = Activator.CreateInstance(shellType);
            if (shell is null) return;

            foreach (var root in roots)
            {
                IEnumerable<string> files;
                try
                {
                    files = Directory.EnumerateFiles(root, "*.lnk", new EnumerationOptions
                    {
                        RecurseSubdirectories = true,
                        IgnoreInaccessible = true
                    });
                }
                catch { continue; }

                foreach (var fullPath in files)
                {
                    object? shortcut = null;
                    try
                    {
                        shortcut = ((dynamic)shell).CreateShortcut(fullPath);
                        var rawTarget = (string?)((dynamic)shortcut).TargetPath ?? string.Empty;
                        var rawArgs = (string?)((dynamic)shortcut).Arguments ?? string.Empty;
                        var rawIcon = (string?)((dynamic)shortcut).IconLocation ?? string.Empty;
                        var targetPath = Environment.ExpandEnvironmentVariables(rawTarget);
                        var commaIndex = rawIcon.LastIndexOf(',');
                        var trimmedIcon = (commaIndex > 0 ? rawIcon[..commaIndex] : rawIcon).Trim('"');
                        var iconSource = Environment.ExpandEnvironmentVariables(trimmedIcon);
                        var baseName = Path.GetFileNameWithoutExtension(fullPath);

                        output.Add(new
                        {
                            name = baseName,
                            launchType = "path",
                            target = fullPath,
                            identity = $"{targetPath}|{rawArgs}",
                            iconSource,
                            icon = ReadParsingNameIcon(fullPath),
                            shortcut = new
                            {
                                name = baseName,
                                shortcutPath = fullPath,
                                targetPath,
                                arguments = rawArgs
                            }
                        });
                    }
                    catch
                    {
                        // 忽略损坏或无法读取的单个快捷方式。
                    }
                    finally
                    {
                        if (shortcut is not null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
                    }
                }
            }
        }
        finally
        {
            if (shell is not null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    private static void DiscoverAppsFolder(List<object> output)
    {
        IShellItem2? appsFolder = null;
        IEnumShellItems? enumerator = null;
        try
        {
            var shellItem2Guid = typeof(IShellItem2).GUID;
            if (SHCreateItemFromParsingName("shell:AppsFolder", IntPtr.Zero, ref shellItem2Guid, out appsFolder) != 0 || appsFolder is null)
                return;

            var bhid = BhidEnumItems;
            var enumGuid = typeof(IEnumShellItems).GUID;
            if (appsFolder.BindToHandler(IntPtr.Zero, ref bhid, ref enumGuid, out enumerator) != 0 || enumerator is null)
                return;

            while (enumerator.Next(1, out var item, out var fetched) == 0 && fetched == 1 && item is not null)
            {
                try
                {
                    var name = GetDisplayName(item, 0);
                    var appId = GetAppUserModelId(item) ?? GetDisplayName(item, 0x80028000);
                    if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(appId)) continue;

                    var launchType = Path.IsPathRooted(appId) && appId.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                        ? "path"
                        : "appId";
                    var icon = item is IShellItemImageFactory factory ? ExtractFactoryIcon(factory) : null;

                    output.Add(new
                    {
                        name,
                        launchType,
                        target = appId,
                        icon
                    });
                }
                catch { }
                finally
                {
                    Marshal.ReleaseComObject(item);
                }
            }
        }
        catch { }
        finally
        {
            if (enumerator is not null) Marshal.ReleaseComObject(enumerator);
            if (appsFolder is not null) Marshal.ReleaseComObject(appsFolder);
        }
    }

    private static string? GetDisplayName(IShellItem item, uint sigdn)
    {
        if (item.GetDisplayName(sigdn, out var ptr) != 0 || ptr == IntPtr.Zero) return null;
        try { return Marshal.PtrToStringUni(ptr); }
        finally { Marshal.FreeCoTaskMem(ptr); }
    }

    private static string? GetAppUserModelId(IShellItem item)
    {
        if (item is not IShellItem2 item2) return null;
        if (item2.GetString(ref PkeyAppUserModelId, out var ptr) != 0 || ptr == IntPtr.Zero) return null;
        try { return Marshal.PtrToStringUni(ptr); }
        finally { Marshal.FreeCoTaskMem(ptr); }
    }

    private static string? ReadParsingNameIcon(string parsingName)
    {
        IShellItemImageFactory? factory = null;
        try
        {
            var iid = typeof(IShellItemImageFactory).GUID;
            if (SHCreateItemFromParsingName(parsingName, IntPtr.Zero, ref iid, out factory) != 0 || factory is null)
                return null;
            return ExtractFactoryIcon(factory);
        }
        catch { return null; }
        finally
        {
            if (factory is not null) Marshal.ReleaseComObject(factory);
        }
    }

    private static string? ExtractFactoryIcon(IShellItemImageFactory factory)
    {
        var hBitmap = IntPtr.Zero;
        try
        {
            if (factory.GetImage(new NativeSize { Width = 32, Height = 32 }, 0x04, out hBitmap) != 0 || hBitmap == IntPtr.Zero)
                return null;
            using var image = Image.FromHbitmap(hBitmap);
            using var stream = new MemoryStream();
            image.Save(stream, ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
        }
        catch { return null; }
        finally
        {
            if (hBitmap != IntPtr.Zero) DeleteObject(hBitmap);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeSize { public int Width; public int Height; }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey(Guid formatId, uint propertyId)
    {
        public Guid FormatId = formatId;
        public uint PropertyId = propertyId;
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        [PreserveSig] int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IEnumShellItems? ppv);
        [PreserveSig] int GetParent(out IShellItem? ppsi);
        [PreserveSig] int GetDisplayName(uint sigdnName, out IntPtr ppszName);
        [PreserveSig] int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        [PreserveSig] int Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("7e9fb0d3-919f-4307-ab2e-9b1860310c93"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem2 : IShellItem
    {
        [PreserveSig] new int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IEnumShellItems? ppv);
        [PreserveSig] new int GetParent(out IShellItem? ppsi);
        [PreserveSig] new int GetDisplayName(uint sigdnName, out IntPtr ppszName);
        [PreserveSig] new int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        [PreserveSig] new int Compare(IShellItem psi, uint hint, out int piOrder);
        [PreserveSig] int GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int GetPropertyStoreWithCreateObject(int flags, IntPtr punkCreateObject, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int GetPropertyStoreForKeys(IntPtr rgKeys, uint cKeys, int flags, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int GetPropertyDescriptionList(ref PropertyKey keyType, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int Update(IntPtr pbc);
        [PreserveSig] int GetProperty(ref PropertyKey key, IntPtr ppropvar);
        [PreserveSig] int GetCLSID(ref PropertyKey key, out Guid pclsid);
        [PreserveSig] int GetFileTime(ref PropertyKey key, out long pft);
        [PreserveSig] int GetInt32(ref PropertyKey key, out int pi);
        [PreserveSig] int GetString(ref PropertyKey key, out IntPtr ppsz);
        [PreserveSig] int GetUInt32(ref PropertyKey key, out uint pui);
        [PreserveSig] int GetUInt64(ref PropertyKey key, out ulong pull);
        [PreserveSig] int GetBool(ref PropertyKey key, out int pf);
    }

    [ComImport, Guid("70629033-e363-4a28-a567-0db78006e6d7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IEnumShellItems
    {
        [PreserveSig] int Next(uint celt, out IShellItem? rgelt, out uint pceltFetched);
        [PreserveSig] int Skip(uint celt);
        [PreserveSig] int Reset();
        [PreserveSig] int Clone(out IEnumShellItems? ppenum);
    }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(NativeSize size, uint flags, out IntPtr phbm);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItem2? ppv);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItemImageFactory? ppv);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);
}
