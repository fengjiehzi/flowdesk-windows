using System.Diagnostics;
using System.Threading;

namespace SmartDeskBox.DesktopApp;

public sealed class DesktopIconLease : IDisposable
{
    private static readonly string MarkerPath = Path.Combine(Path.GetTempPath(), "SmartDeskBox.icons.lease");
    private readonly IntPtr icons;
    private readonly uint explorerId;
    private readonly EventWaitHandle? shutdown;
    private readonly Process? guardian;
    private readonly bool ownsLease;
    private bool disposed;

    public DesktopIconLease(IntPtr icons, string executablePath)
    {
        this.icons = icons;
        explorerId = DesktopNative.ProcessId(icons);
        if (icons == IntPtr.Zero) throw new InvalidOperationException("未找到桌面图标列表，已保留原桌面。");
        if (!DesktopNative.HasVisibleStyle(icons))
        {
            // 若上次异常退出遗留了租约标记，仍接管恢复权以确保用户可恢复原桌面图标。
            ownsLease = HasMatchingMarker(icons, explorerId);
            if (!ownsLease) return;
        }
        else
        {
            ownsLease = true;
        }

        var eventName = "Local\\SmartDeskBox.IconGuard." + Guid.NewGuid().ToString("N");
        shutdown = new(false, EventResetMode.ManualReset, eventName);
        using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, eventName + ".Ready");
        var start = new ProcessStartInfo(executablePath) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        foreach (var argument in new[] { "--icon-guardian", Environment.ProcessId.ToString(), icons.ToInt64().ToString(), explorerId.ToString(), eventName })
            start.ArgumentList.Add(argument);
        try
        {
            WriteMarker(icons, explorerId);
            guardian = Process.Start(start) ?? throw new IOException("无法启动桌面图标恢复进程。");
            if (!ready.WaitOne(TimeSpan.FromSeconds(5))) throw new IOException("图标恢复进程未就绪，已保留系统图标。");
            DesktopNative.ShowWindow(icons, 0);
        }
        catch
        {
            ClearMarker();
            shutdown.Set();
            guardian?.Dispose();
            shutdown.Dispose();
            throw;
        }
    }

    private static bool HasMatchingMarker(IntPtr icons, uint explorerId)
    {
        try
        {
            return File.Exists(MarkerPath) && File.ReadAllText(MarkerPath).Trim() == $"{icons.ToInt64()}:{explorerId}";
        }
        catch { return false; }
    }

    private static void WriteMarker(IntPtr icons, uint explorerId)
    {
        try { File.WriteAllText(MarkerPath, $"{icons.ToInt64()}:{explorerId}"); } catch { }
    }

    private static void ClearMarker() => ClearMarkerFile();

    internal static void ClearMarkerFile()
    {
        try { if (File.Exists(MarkerPath)) File.Delete(MarkerPath); } catch { }
    }

    public static void RunGuardian(string[] args)
    {
        using var shutdown = EventWaitHandle.OpenExisting(args[4]);
        using var ready = EventWaitHandle.OpenExisting(args[4] + ".Ready");
        var icons = new IntPtr(long.Parse(args[2]));
        var explorer = uint.Parse(args[3]);
        Process? parent = null;
        try { parent = Process.GetProcessById(int.Parse(args[1])); }
        catch (Exception) { }
        ready.Set();
        using (parent)
        {
            while (parent != null && !parent.WaitForExit(300))
                if (shutdown.WaitOne(0)) return;
            if (!shutdown.WaitOne(0))
            {
                DesktopNative.RestoreIcons(icons, explorer);
                ClearMarker();
            }
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (ownsLease)
        {
            DesktopNative.RestoreIcons(icons, explorerId);
            ClearMarker();
        }
        if (shutdown == null) return;
        shutdown.Set();
        guardian?.WaitForExit(1000);
        guardian?.Dispose();
        shutdown.Dispose();
    }
}
