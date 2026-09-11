using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Automation;

namespace WindowsDynamicIsland.NotificationBridge;

internal sealed class DesktopPopupListener : IDisposable
{
    private const uint EventObjectShow = 0x8002;
    private const uint EventObjectNameChange = 0x800C;
    private const uint WineventOutOfContext = 0;
    private const uint GaRoot = 2;
    private readonly Control _dispatcher;
    private readonly Action<object> _write;
    private readonly WinEventDelegate _callback;
    private readonly HashSet<IntPtr> _pending = [];
    private readonly Dictionary<string, string> _statuses = [];
    private readonly Dictionary<string, DateTime> _recent = [];
    private IntPtr _showHook;
    private IntPtr _nameHook;
    private long _sequence = Environment.TickCount64;
    private bool _enabled;

    internal DesktopPopupListener(Control dispatcher, Action<object> write)
    {
        _dispatcher = dispatcher;
        _write = write;
        _callback = OnWinEvent;
    }

    internal void Configure(bool enabled)
    {
        if (_enabled == enabled) return;
        _enabled = enabled;
        if (enabled)
        {
            _showHook = Native.SetWinEventHook(EventObjectShow, EventObjectShow, IntPtr.Zero, _callback, 0, 0, WineventOutOfContext);
            _nameHook = Native.SetWinEventHook(EventObjectNameChange, EventObjectNameChange, IntPtr.Zero, _callback, 0, 0, WineventOutOfContext);
            if (_showHook == IntPtr.Zero || _nameHook == IntPtr.Zero)
            {
                SetAllStatus("error");
                StopHooks();
                return;
            }
            RefreshStatuses();
        }
        else
        {
            StopHooks();
            SetAllStatus("disabled");
        }
    }

    internal void RefreshStatuses()
    {
        if (!_enabled) return;
        foreach (var adapter in Adapters)
        {
            var running = Process.GetProcessesByName(adapter.ProcessName).Length > 0;
            if (!running) SetStatus(adapter.Id, adapter.Name, "app-not-running");
            else if (!_statuses.TryGetValue(adapter.Id, out var status) || status is "app-not-running" or "capturing")
                SetStatus(adapter.Id, adapter.Name, "waiting");
        }
    }

    internal void OpenSource(string appId)
    {
        var adapter = Adapters.FirstOrDefault(item => item.Id == appId);
        if (adapter is null) return;
        var process = Process.GetProcessesByName(adapter.ProcessName).FirstOrDefault(item => item.MainWindowHandle != IntPtr.Zero);
        if (process is null) return;
        Native.ShowWindow(process.MainWindowHandle, 9);
        Native.SetForegroundWindow(process.MainWindowHandle);
    }

    private void OnWinEvent(IntPtr hook, uint eventType, IntPtr hwnd, int objectId, int childId, uint threadId, uint time)
    {
        if (!_enabled || hwnd == IntPtr.Zero) return;
        var root = Native.GetAncestor(hwnd, GaRoot);
        if (root == IntPtr.Zero) root = hwnd;
        lock (_pending)
        {
            if (!_pending.Add(root)) return;
        }
        _ = Task.Delay(150).ContinueWith(_ =>
        {
            if (_dispatcher.IsDisposed) return;
            _dispatcher.BeginInvoke(() =>
            {
                lock (_pending) _pending.Remove(root);
                Capture(root);
            });
        }, TaskScheduler.Default);
    }

    private void Capture(IntPtr hwnd)
    {
        if (!_enabled || !TryGetCandidate(hwnd, out var adapter)) return;
        try
        {
            var (title, body) = ExtractText(hwnd, adapter.Name);
            var fingerprint = $"{adapter.Id}\0{hwnd}\0{title}\0{body}";
            if (IsDuplicate(_recent, fingerprint, DateTime.UtcNow)) return;
            SetStatus(adapter.Id, adapter.Name, "capturing");
            _write(new
            {
                type = "desktopNotification",
                notification = new
                {
                    platformId = unchecked((uint)Interlocked.Increment(ref _sequence)),
                    appId = adapter.Id,
                    appName = adapter.Name,
                    icon = (string?)null,
                    title,
                    body,
                    createdAt = DateTime.UtcNow.ToString("O")
                }
            });
        }
        catch (Exception error) when (error is UnauthorizedAccessException || error.HResult == unchecked((int)0x80070005))
        {
            SetStatus(adapter.Id, adapter.Name, "integrity-mismatch");
        }
        catch
        {
            SetStatus(adapter.Id, adapter.Name, "error");
        }
    }

    private static bool TryGetCandidate(IntPtr hwnd, out Adapter adapter)
    {
        adapter = null!;
        if (!Native.IsWindowVisible(hwnd)) return false;
        Native.GetWindowThreadProcessId(hwnd, out var processId);
        try
        {
            using var process = Process.GetProcessById((int)processId);
            adapter = AdapterForProcess(process.ProcessName)!;
            if (adapter is null) return false;
        }
        catch
        {
            return false;
        }

        var className = GetClassName(hwnd);
        if (!ClassMatches(adapter.Id, className) || !Native.GetWindowRect(hwnd, out var rect)) return false;
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width is < 200 or > 720 || height is < 45 or > 420) return false;
        var screen = Screen.FromHandle(hwnd).Bounds;
        var nearEdge = screen.Right - rect.Right <= 220 || rect.Top - screen.Top <= 100 || screen.Bottom - rect.Bottom <= 160;
        return nearEdge && width < screen.Width * .6 && height < screen.Height * .5;
    }

    internal static (string Title, string Body) ExtractText(IntPtr hwnd, string appName)
    {
        var root = AutomationElement.FromHandle(hwnd);
        var names = new List<string>(8);
        var walker = TreeWalker.ContentViewWalker;
        var stack = new Stack<(AutomationElement Element, int Depth)>();
        stack.Push((root, 0));
        var visited = 0;
        while (stack.Count > 0 && visited++ < 64)
        {
            var (element, depth) = stack.Pop();
            var name = NormalizeText(element.Current.Name);
            if (depth > 0 && IsUsefulText(name, appName) && !names.Contains(name, StringComparer.Ordinal)) names.Add(name);
            if (depth >= 8) continue;
            var children = new List<AutomationElement>();
            for (var child = walker.GetFirstChild(element); child is not null; child = walker.GetNextSibling(child)) children.Add(child);
            for (var index = children.Count - 1; index >= 0; index--) stack.Push((children[index], depth + 1));
        }
        return FormatText(names, appName);
    }

    internal static (string Title, string Body) FormatText(IReadOnlyList<string> names, string appName)
    {
        if (names.Count == 0) return (appName, $"{appName}收到一条新消息");
        var title = BridgeContext.Limit(names[0], 256);
        var body = BridgeContext.Limit(string.Join(" ", names.Skip(1)), 2048);
        return (title, body.Length > 0 ? body : $"{appName}收到一条新消息");
    }

    internal static Adapter? AdapterForProcess(string processName) => Adapters.FirstOrDefault(
        adapter => processName.Equals(adapter.ProcessName, StringComparison.OrdinalIgnoreCase));

    internal static bool ClassMatches(string appId, string className) => appId switch
    {
        "desktop:feishu" => className.StartsWith("Chrome_WidgetWin_", StringComparison.Ordinal),
        "desktop:weixin" => className.Contains("QWindow", StringComparison.Ordinal),
        _ => false
    };

    internal static string NormalizeText(string value) => Regex.Replace(value ?? string.Empty, @"\s+", " ").Trim();

    internal static bool IsDuplicate(Dictionary<string, DateTime> recent, string fingerprint, DateTime now)
    {
        foreach (var old in recent.Where(item => now - item.Value > TimeSpan.FromSeconds(5)).Select(item => item.Key).ToArray())
            recent.Remove(old);
        if (recent.ContainsKey(fingerprint)) return true;
        recent[fingerprint] = now;
        return false;
    }

    private static bool IsUsefulText(string value, string appName) =>
        value.Length is > 0 and <= 2048
        && !value.Equals(appName, StringComparison.OrdinalIgnoreCase)
        && value is not "飞书" and not "微信" and not "Weixin" and not "关闭" and not "回复" and not "标记已读" and not "查看更多"
        && !Regex.IsMatch(value, @"^\d{1,2}:\d{2}$");

    private static string GetClassName(IntPtr hwnd)
    {
        var buffer = new char[256];
        var length = Native.GetClassName(hwnd, buffer, buffer.Length);
        return length > 0 ? new string(buffer, 0, length) : string.Empty;
    }

    private void SetAllStatus(string status)
    {
        foreach (var adapter in Adapters) SetStatus(adapter.Id, adapter.Name, status);
    }

    private void SetStatus(string id, string name, string status)
    {
        if (_statuses.TryGetValue(id, out var current) && current == status) return;
        _statuses[id] = status;
        _write(new { type = "desktopAdapterStatus", adapter = new { id, name, status } });
    }

    private void StopHooks()
    {
        if (_showHook != IntPtr.Zero) Native.UnhookWinEvent(_showHook);
        if (_nameHook != IntPtr.Zero) Native.UnhookWinEvent(_nameHook);
        _showHook = _nameHook = IntPtr.Zero;
    }

    public void Dispose()
    {
        _enabled = false;
        StopHooks();
    }

    internal sealed record Adapter(string Id, string Name, string ProcessName);
    private static readonly Adapter[] Adapters =
    [
        new("desktop:feishu", "飞书", "Feishu"),
        new("desktop:weixin", "微信", "Weixin")
    ];

    private delegate void WinEventDelegate(IntPtr hook, uint eventType, IntPtr hwnd, int objectId, int childId, uint threadId, uint time);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        internal int Left;
        internal int Top;
        internal int Right;
        internal int Bottom;
    }

    private static class Native
    {
        [DllImport("user32.dll")]
        internal static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventDelegate callback, uint processId, uint threadId, uint flags);
        [DllImport("user32.dll")]
        internal static extern bool UnhookWinEvent(IntPtr hook);
        [DllImport("user32.dll")]
        internal static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [DllImport("user32.dll")]
        internal static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")]
        internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetClassName(IntPtr hwnd, char[] className, int maxCount);
        [DllImport("user32.dll")]
        internal static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
        [DllImport("user32.dll")]
        internal static extern bool ShowWindow(IntPtr hwnd, int command);
        [DllImport("user32.dll")]
        internal static extern bool SetForegroundWindow(IntPtr hwnd);
    }
}
