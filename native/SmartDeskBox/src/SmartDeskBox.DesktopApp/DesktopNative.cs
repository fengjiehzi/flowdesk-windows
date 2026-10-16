using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Interop;

namespace SmartDeskBox.DesktopApp;

public static class DesktopNative
{
    public static (IntPtr Host, IntPtr Icons) FindDesktop()
    {
        var host = IntPtr.Zero;
        var icons = IntPtr.Zero;
        EnumWindows((window, _) =>
        {
            var view = FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (view == IntPtr.Zero) return true;
            host = window;
            icons = FindWindowEx(view, IntPtr.Zero, "SysListView32", null);
            return false;
        }, IntPtr.Zero);
        if (host == IntPtr.Zero) throw new InvalidOperationException("未找到 Explorer 桌面。请启动 Windows 资源管理器后重试。");
        return (host, icons);
    }

    public static IntPtr Attach(Window window, IntPtr host)
    {
        var handle = new WindowInteropHelper(window).Handle;
        var bounds = Bounds(handle);
        // Desktop ownership keeps WPF surfaces independent of Explorer's cross-process child layout.
        new WindowInteropHelper(window).Owner = host;
        var extended = GetWindowLongPtr(handle, -20).ToInt64();
        SetWindowLongPtr(handle, -20, new IntPtr(extended | 0x08000000L | 0x00000080L));
        HwndSource.FromHwnd(handle).AddHook((IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled) =>
        {
            if (message != 0x0021) return IntPtr.Zero;
            handled = true;
            if (window is DesktopBoxWindow box && box.WantsKeyboardFocus) SetForegroundWindow(hwnd);
            return new IntPtr(3);
        });
        Place(handle, host, bounds);
        return handle;
    }

    public static void Place(IntPtr handle, IntPtr host, Rect screenBounds)
    {
        if (!SetWindowPos(handle, new IntPtr(1), (int)Math.Round(screenBounds.X), (int)Math.Round(screenBounds.Y),
            (int)Math.Round(screenBounds.Width), (int)Math.Round(screenBounds.Height), 0x0010 | 0x0020 | 0x0040 | 0x0200))
            throw new Win32Exception(Marshal.GetLastPInvokeError());
    }

    public static Rect Bounds(IntPtr handle)
    {
        if (!GetWindowRect(handle, out var rect)) throw new Win32Exception(Marshal.GetLastPInvokeError());
        return new(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
    }

    public static bool IsAttached(IntPtr handle, IntPtr host) => IsWindow(handle) && IsWindow(host) && GetWindow(handle, 4) == host;
    public static bool HasVisibleStyle(IntPtr handle) => IsWindow(handle) && (GetWindowLongPtr(handle, -16).ToInt64() & 0x10000000L) != 0;

    public static uint ProcessId(IntPtr handle) { GetWindowThreadProcessId(handle, out var id); return id; }

    public static List<IntPtr> BoxHandles(int processId)
    {
        var (host, _) = FindDesktop();
        var handles = new List<IntPtr>();
        EnumWindows((window, _) =>
        {
            if (ProcessId(window) == processId && GetWindow(window, 4) == host) handles.Add(window);
            return true;
        }, IntPtr.Zero);
        return handles;
    }

    public static void RestoreIcons(IntPtr handle, uint explorerId)
    {
        var className = new StringBuilder(64);
        GetClassName(handle, className, className.Capacity);
        if (IsWindow(handle) && ProcessId(handle) == explorerId && className.ToString() == "SysListView32") ShowWindow(handle, 5);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; }
    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string? name);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
}
