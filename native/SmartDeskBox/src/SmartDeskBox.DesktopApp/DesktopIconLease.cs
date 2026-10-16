using System.Diagnostics;
using System.Threading;

namespace SmartDeskBox.DesktopApp;

public sealed class DesktopIconLease : IDisposable
{
    private readonly IntPtr icons;
    private readonly uint explorerId;
    private readonly EventWaitHandle? shutdown;
    private readonly Process? guardian;
    private bool disposed;

    public DesktopIconLease(IntPtr icons, string executablePath)
    {
        this.icons = icons;
        explorerId = DesktopNative.ProcessId(icons);
        if (icons == IntPtr.Zero) throw new InvalidOperationException("未找到桌面图标列表，已保留原桌面。");
        if (!DesktopNative.HasVisibleStyle(icons)) return;
        var eventName = "Local\\SmartDeskBox.IconGuard." + Guid.NewGuid().ToString("N");
        shutdown = new(false, EventResetMode.ManualReset, eventName);
        using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, eventName + ".Ready");
        var start = new ProcessStartInfo(executablePath) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
        foreach (var argument in new[] { "--icon-guardian", Environment.ProcessId.ToString(), icons.ToInt64().ToString(), explorerId.ToString(), eventName })
            start.ArgumentList.Add(argument);
        try
        {
            guardian = Process.Start(start) ?? throw new IOException("无法启动桌面图标恢复进程。");
            if (!ready.WaitOne(TimeSpan.FromSeconds(5))) throw new IOException("图标恢复进程未就绪，已保留系统图标。");
            DesktopNative.ShowWindow(icons, 0);
        }
        catch
        {
            shutdown.Set();
            guardian?.Dispose();
            shutdown.Dispose();
            throw;
        }
    }

    public static void RunGuardian(string[] args)
    {
        using var shutdown = EventWaitHandle.OpenExisting(args[4]);
        using var ready = EventWaitHandle.OpenExisting(args[4] + ".Ready");
        var icons = new IntPtr(long.Parse(args[2]));
        var explorer = uint.Parse(args[3]);
        Process? parent = null;
        try { parent = Process.GetProcessById(int.Parse(args[1])); }
        catch (ArgumentException) { }
        ready.Set();
        using (parent)
        {
            while (parent != null && !parent.WaitForExit(300))
                if (shutdown.WaitOne(0)) return;
            if (!shutdown.WaitOne(0)) DesktopNative.RestoreIcons(icons, explorer);
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (shutdown == null) return;
        DesktopNative.RestoreIcons(icons, explorerId);
        shutdown.Set();
        guardian?.WaitForExit(1000);
        guardian?.Dispose();
        shutdown.Dispose();
    }
}
