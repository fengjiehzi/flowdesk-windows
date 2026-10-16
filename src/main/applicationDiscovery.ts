import { existsSync } from 'node:fs'
import { z } from 'zod'
import { dedupeInstalledApplications, isLaunchableApplicationShortcut, launcherIconSchema } from '../shared/launcher'

const applicationSchema = z.object({
  name: z.string(), launchType: z.enum(['path', 'appId']), target: z.string().trim().min(1).max(2048),
  identity: z.string().optional(), iconSource: z.string().optional(), icon: launcherIconSchema.nullish(),
  shortcut: z.object({ name: z.string(), shortcutPath: z.string(), targetPath: z.string(), arguments: z.string() }).optional()
})

export function parseDiscoveredApplications(raw: unknown) {
  return dedupeInstalledApplications((Array.isArray(raw) ? raw : [raw]).flatMap((row) => {
    const parsed = applicationSchema.safeParse(row)
    if (!parsed.success) return []
    const item = parsed.data
    if (item.launchType === 'path' && !existsSync(item.target)) return []
    if (item.shortcut && !isLaunchableApplicationShortcut(item.shortcut)) return []
    if (/卸载|(?:^|[\s_-])(?:unins\d*|uninstall(?:er)?)(?:$|[\s_-])/i.test(item.name)) return []
    return [{ ...item, icon: item.icon ?? undefined }]
  }))
}

// AppsFolder includes packaged apps and registered desktop apps missing from .lnk enumeration.
export const powershellDiscoveryScript = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class IslandShellIcon {
    [StructLayout(LayoutKind.Sequential)] public struct Size { public int Width; public int Height; }
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IImageFactory { [PreserveSig] int GetImage(Size size, uint flags, out IntPtr bitmap); }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
    private static extern int SHCreateItemFromParsingName(string name, IntPtr context, ref Guid iid, out IImageFactory factory);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr handle);
    public static string Read(string name) {
        IImageFactory factory = null;
        IntPtr bitmap = IntPtr.Zero;
        try {
            Guid iid = typeof(IImageFactory).GUID;
            if (SHCreateItemFromParsingName(name, IntPtr.Zero, ref iid, out factory) != 0) return null;
            if (factory.GetImage(new Size { Width=32, Height=32 }, 4, out bitmap) != 0 || bitmap == IntPtr.Zero) return null;
            using (var image = Image.FromHbitmap(bitmap))
            using (var stream = new MemoryStream()) {
                image.Save(stream, ImageFormat.Png);
                return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
            }
        } catch { return null; }
        finally {
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (factory != null) Marshal.ReleaseComObject(factory);
        }
    }
}
'@
$roots = @(
  [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'),
  [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
$shell = New-Object -ComObject WScript.Shell
$items = [Collections.Generic.List[object]]::new()
foreach ($root in $roots) {
  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.lnk') {
    $shortcut = $shell.CreateShortcut($file.FullName)
    $targetPath = [Environment]::ExpandEnvironmentVariables($shortcut.TargetPath)
    $iconSource = [Environment]::ExpandEnvironmentVariables(($shortcut.IconLocation -replace ',-?\d+$', '').Trim('"'))
    $items.Add([pscustomobject]@{
      name=$file.BaseName; launchType='path'; target=$file.FullName
      identity=($targetPath + '|' + [string]$shortcut.Arguments); iconSource=$iconSource
      icon=[IslandShellIcon]::Read($file.FullName)
      shortcut=@{name=$file.BaseName;shortcutPath=$file.FullName;targetPath=$targetPath;arguments=[string]$shortcut.Arguments}
    })
  }
}
foreach ($application in Get-StartApps) {
  $target = [string]$application.AppID
  if (-not $target -or -not $application.Name) { continue }
  $launchType = if ([IO.Path]::IsPathRooted($target) -and $target.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) { 'path' } else { 'appId' }
  $items.Add([pscustomobject]@{
    name=[string]$application.Name; launchType=$launchType; target=$target
    icon=[IslandShellIcon]::Read(('shell:AppsFolder\' + $target))
  })
}
@($items.ToArray()) | ConvertTo-Json -Compress -Depth 5
`
