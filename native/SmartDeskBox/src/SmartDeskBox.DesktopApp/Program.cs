using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace SmartDeskBox.DesktopApp;

public static class Program
{
    private const uint Synchronize = 0x00100000;
    private const uint Infinite = 0xFFFFFFFF;
    private const uint WaitObject0 = 0x00000000;

    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Length == 5 && args[0] == "--icon-guardian")
        {
            try
            {
                RunLightweightGuardian(args);
                return 0;
            }
            catch
            {
                return 1;
            }
        }
        RunWpfApplication();
        return 0;
    }

    // 隔离 WPF 类型引用，确保 --icon-guardian 模式不触发 WPF 程序集加载。
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void RunWpfApplication()
    {
        var app = new App();
        app.InitializeComponent();
        app.Run();
    }

    private static void RunLightweightGuardian(string[] args)
    {
        using var shutdown = EventWaitHandle.OpenExisting(args[4]);
        using var ready = EventWaitHandle.OpenExisting(args[4] + ".Ready");
        var icons = new IntPtr(long.Parse(args[2]));
        var explorerId = uint.Parse(args[3]);
        var parentPid = int.Parse(args[1]);

        var parentHandle = OpenProcess(Synchronize, false, (uint)parentPid);
        ready.Set();
        try
        {
            if (parentHandle == IntPtr.Zero)
            {
                if (!shutdown.WaitOne(0)) RestoreExplorerIcons(icons, explorerId);
                return;
            }

            var shutdownHandle = shutdown.SafeWaitHandle.DangerousGetHandle();
            IntPtr[] handles = [shutdownHandle, parentHandle];
            var signaled = WaitForMultipleObjects(2, handles, false, Infinite);
            // signaled == WaitObject0 表示收到正常退出事件；否则父进程异常终止，立即恢复桌面图标。
            if (signaled != WaitObject0 && !shutdown.WaitOne(0))
            {
                RestoreExplorerIcons(icons, explorerId);
                DesktopIconLease.ClearMarkerFile();
            }
        }
        finally
        {
            if (parentHandle != IntPtr.Zero) CloseHandle(parentHandle);
        }
    }

    private static void RestoreExplorerIcons(IntPtr handle, uint explorerId)
    {
        var className = new StringBuilder(64);
        GetClassName(handle, className, className.Capacity);
        GetWindowThreadProcessId(handle, out var pid);
        if (IsWindow(handle) && pid == explorerId && className.ToString() == "SysListView32")
        {
            ShowWindow(handle, 5);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint milliseconds);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int count);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);
}
