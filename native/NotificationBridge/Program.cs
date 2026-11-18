using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using Windows.Storage.Streams;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace WindowsDynamicIsland.NotificationBridge;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        // WinExe has redirected pipes but no attached console/code page.
        Console.SetIn(new StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false)));
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = true });
        if (args.Contains("--notification-lifecycle-test", StringComparer.OrdinalIgnoreCase))
        {
            var session = new NotificationSession();
            var pending = session.Start();
            session.Stop();
            if (session.IsCurrent(pending)) throw new InvalidOperationException("Stopped access request remained current.");
            var restarted = session.Start();
            if (session.IsCurrent(pending) || !session.IsCurrent(restarted)) throw new InvalidOperationException("Old access request replaced a new session.");
            session.Stop();
            if (session.Enabled) throw new InvalidOperationException("Notification session failed to stop.");
            Console.WriteLine("Notification lifecycle checks passed (3 scenarios)");
            return;
        }
        if (args.Contains("--discover-apps", StringComparer.OrdinalIgnoreCase))
        {
            AppDiscoveryService.WriteJson();
            return;
        }
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            SelfTest();
            return;
        }

        ApplicationConfiguration.Initialize();
        using var context = new BridgeContext();
        Application.Run(context);
    }

    private static void SelfTest()
    {
        if (BridgeContext.AccessStatusName(UserNotificationListenerAccessStatus.Allowed) != "allowed")
            throw new InvalidOperationException("Allowed access status mapping failed.");
        if (BridgeContext.SuppressionName(QueryUserNotificationState.AcceptsNotifications) != "accepts")
            throw new InvalidOperationException("Notification suppression mapping failed.");
        if (BridgeContext.Limit("abcd", 3) != "abc")
            throw new InvalidOperationException("Text limit failed.");
        if (!BridgeContext.IsPlatformUnavailable(new COMException("", unchecked((int)0x803E0105))))
            throw new InvalidOperationException("Notification platform error mapping failed.");
        if (DesktopPopupListener.AdapterForProcess("Feishu")?.Id != "desktop:feishu"
            || !DesktopPopupListener.ClassMatches("desktop:weixin", "Qt51514QWindowIcon"))
            throw new InvalidOperationException("Desktop adapter filtering failed.");
        if (DesktopPopupListener.NormalizeText("  张三\r\n 你好 ") != "张三 你好")
            throw new InvalidOperationException("Desktop popup text normalization failed.");
        var fallback = DesktopPopupListener.FormatText([], "微信");
        if (fallback.Title != "微信" || fallback.Body != "微信收到一条新消息")
            throw new InvalidOperationException("Desktop popup fallback failed.");
        var recent = new Dictionary<string, DateTime>();
        var now = DateTime.UtcNow;
        if (DesktopPopupListener.IsDuplicate(recent, "same", now)
            || !DesktopPopupListener.IsDuplicate(recent, "same", now.AddSeconds(4))
            || DesktopPopupListener.IsDuplicate(recent, "same", now.AddSeconds(6)))
            throw new InvalidOperationException("Desktop popup deduplication failed.");
        if (!ClipboardArchiveListener.IsMediaFile("photo.GIF")
            || ClipboardArchiveListener.IsMediaFile("document.pdf"))
            throw new InvalidOperationException("Clipboard media filtering failed.");
        if (ClipboardArchiveListener.TextFileName(now) != $"{now:yyyy-MM-dd}.txt")
            throw new InvalidOperationException("Clipboard text filename failed.");
        if (!ClipboardArchiveListener.FormatTextEntry("hello", now).StartsWith($"[{now:HH:mm:ss.fff}]"))
            throw new InvalidOperationException("Clipboard text formatting failed.");
        if (ClipboardArchiveListener.CollisionFileName("clip.mp4", now) != $"clip_{now:yyyyMMdd_HHmmssfff}.mp4")
            throw new InvalidOperationException("Clipboard collision filename failed.");
        Console.WriteLine("NotificationBridge self-check passed");
    }
}

internal sealed class BridgeContext : ApplicationContext, IDisposable
{
    private readonly Form _dispatcher = new()
    {
        ShowInTaskbar = false,
        FormBorderStyle = FormBorderStyle.FixedToolWindow,
        StartPosition = FormStartPosition.Manual,
        Location = new Point(-32000, -32000),
        Size = new Size(1, 1),
        Opacity = 0
    };
    private readonly UserNotificationListener _listener = UserNotificationListener.Current;
    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private readonly object _writeLock = new();
    private readonly System.Windows.Forms.Timer _statusTimer = new() { Interval = OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000) ? 15_000 : 5000 };
    private readonly System.Windows.Forms.Timer _notifyDebounceTimer = new() { Interval = 150 };
    private readonly Dictionary<string, string?> _iconCache = new(StringComparer.Ordinal);
    private readonly DesktopPopupListener _desktopPopups;
    private readonly ClipboardArchiveListener _clipboardArchive;
    private readonly NotificationSession _notifications = new();
    private string? _lastSnapshotFingerprint;
    private DateTime _lastServiceStartAttemptUtc = DateTime.MinValue;
    private bool _disposed;

    public BridgeContext()
    {
        _ = _dispatcher.Handle;
        _desktopPopups = new DesktopPopupListener(_dispatcher, Write);
        _clipboardArchive = new ClipboardArchiveListener(Write);
        _statusTimer.Tick += async (_, _) => await PollStatusAsync();
        _notifyDebounceTimer.Tick += async (_, _) =>
        {
            _notifyDebounceTimer.Stop();
            if (!_disposed && _notifications.Enabled) await SyncAsync();
        };
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            try { _listener.NotificationChanged += OnPlatformNotificationChanged; }
            catch { /* 若系统未授予身份或监听受限，回退为定时轮询 */ }
        }
        _statusTimer.Start();
        Write(new { type = "ready" });
        _ = Task.Run(ReadCommandsAsync);
    }

    private void OnPlatformNotificationChanged(UserNotificationListener sender, UserNotificationChangedEventArgs args)
    {
        if (_disposed || !_notifications.Enabled) return;
        PostToUi(() =>
        {
            _notifyDebounceTimer.Stop();
            _notifyDebounceTimer.Start();
            return Task.CompletedTask;
        });
    }

    private static async Task<string?> ReadLineBoundedAsync(TextReader reader, int maxChars)
    {
        var buffer = new System.Text.StringBuilder(128);
        var ch = new char[1];
        var overflow = false;
        while (true)
        {
            var read = await reader.ReadAsync(ch, 0, 1).ConfigureAwait(false);
            if (read == 0)
            {
                return buffer.Length == 0 && !overflow ? null : overflow ? new string(' ', maxChars + 1) : buffer.ToString();
            }
            var c = ch[0];
            if (c == '\n')
            {
                if (overflow) return new string(' ', maxChars + 1);
                if (buffer.Length > 0 && buffer[^1] == '\r') buffer.Length--;
                return buffer.ToString();
            }
            if (buffer.Length < maxChars) buffer.Append(c);
            else overflow = true;
        }
    }

    private async Task ReadCommandsAsync()
    {
        try
        {
            while (!_disposed)
            {
                var line = await ReadLineBoundedAsync(Console.In, 4096);
                if (line is null)
                {
                    PostToUi(async () =>
                    {
                        try { await _clipboardArchive.StopAndFlushAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
                        catch { }
                        finally { Exit(); }
                    });
                    return;
                }
                if (line.Length > 4096)
                {
                    WriteError("Command exceeded 4096 characters.");
                    continue;
                }

                try
                {
                    using var document = JsonDocument.Parse(line);
                    var type = document.RootElement.GetProperty("type").GetString();
                    switch (type)
                    {
                        case "status":
                            OnUiThread(() =>
                            {
                                WriteStatus();
                                WriteSuppression();
                                return Task.CompletedTask;
                            });
                            break;
                        case "requestAccess":
                            OnUiThread(RequestAccessAsync);
                            break;
                        case "start":
                            OnUiThread(StartAsync);
                            break;
                        case "stop":
                            OnUiThread(() =>
                            {
                                Stop();
                                return Task.CompletedTask;
                            });
                            break;
                        case "configure":
                            var desktopEnabled = document.RootElement.GetProperty("desktopPopupNotificationsEnabled").GetBoolean();
                            var clipboardEnabled = document.RootElement.GetProperty("clipboardArchiveEnabled").GetBoolean();
                            var clipboardPath = document.RootElement.GetProperty("clipboardArchivePath").GetString() ?? string.Empty;
                            OnUiThread(() =>
                            {
                                _desktopPopups.Configure(desktopEnabled);
                                _clipboardArchive.Configure(clipboardEnabled, clipboardPath);
                                return Task.CompletedTask;
                            });
                            break;
                        case "openSource":
                            var appId = document.RootElement.GetProperty("appId").GetString() ?? string.Empty;
                            OnUiThread(() =>
                            {
                                _desktopPopups.OpenSource(appId);
                                return Task.CompletedTask;
                            });
                            break;
                        case "shutdown":
                            OnUiThread(async () =>
                            {
                                Stop();
                                _desktopPopups.Configure(false);
                                try
                                {
                                    await _clipboardArchive.StopAndFlushAsync();
                                }
                                finally
                                {
                                    Exit();
                                }
                            });
                            return;
                        default:
                            WriteError("Unknown command.");
                            break;
                    }
                }
                catch (Exception error)
                {
                    WriteError(error.Message);
                }
            }
        }
        catch (Exception error)
        {
            WriteError(error.Message);
            Exit();
        }
    }

    private void OnUiThread(Func<Task> action) => PostToUi(action);

    private void PostToUi(Func<Task> action)
    {
        if (_disposed || _dispatcher.IsDisposed || !_dispatcher.IsHandleCreated) return;
        try
        {
            _dispatcher.BeginInvoke(async () =>
            {
                if (_disposed) return;
                try
                {
                    await action();
                }
                catch (Exception error)
                {
                    WriteError(error.Message);
                }
            });
        }
        catch (ObjectDisposedException) { }
        catch (InvalidOperationException) { }
    }

    private async Task RequestAccessAsync()
    {
        var version = _notifications.Start();
        var status = await _listener.RequestAccessAsync();
        if (_disposed || !_notifications.IsCurrent(version)) return;
        Write(new { type = "status", status = AccessStatusName(status) });
        if (status == UserNotificationListenerAccessStatus.Allowed) await SyncAsync();
    }

    private async Task StartAsync()
    {
        _notifications.Start();
        var status = _listener.GetAccessStatus();
        Write(new { type = "status", status = AccessStatusName(status) });
        if (status != UserNotificationListenerAccessStatus.Allowed) return;
        await SyncAsync();
    }

    private void Stop()
    {
        _notifications.Stop();
    }

    private async Task PollStatusAsync()
    {
        if (!_notifications.Enabled || _disposed) return;
        try
        {
            _desktopPopups.RefreshStatuses();
            var status = _listener.GetAccessStatus();
            Write(new { type = "status", status = AccessStatusName(status) });
            WriteSuppression();
            if (status == UserNotificationListenerAccessStatus.Allowed)
            {
                // ponytail: foreground listener events break snapshot reads on some Windows 10 builds; poll instead.
                await SyncAsync();
            }
        }
        catch (Exception error)
        {
            WriteError(error.Message);
        }
    }

    private async Task SyncAsync()
    {
        var version = _notifications.Version;
        if (_disposed || !_notifications.IsCurrent(version)) return;
        if (_listener.GetAccessStatus() != UserNotificationListenerAccessStatus.Allowed)
        {
            WriteStatus();
            return;
        }
        if (!await _syncLock.WaitAsync(0)) return;
        try
        {
            WriteSuppression();
            IReadOnlyList<UserNotification> platformNotifications;
            try
            {
                platformNotifications = await _listener.GetNotificationsAsync(NotificationKinds.Toast);
            }
            catch (Exception error) when (IsPlatformUnavailable(error))
            {
                if (DateTime.UtcNow - _lastServiceStartAttemptUtc >= TimeSpan.FromSeconds(60))
                {
                    _lastServiceStartAttemptUtc = DateTime.UtcNow;
                    await StartNotificationServiceAsync();
                }
                platformNotifications = await _listener.GetNotificationsAsync(NotificationKinds.Toast);
            }
            var ordered = platformNotifications.OrderByDescending(item => item.CreationTime).Take(100).ToList();
            var fingerprint = string.Join("|", ordered.Select(item => $"{item.Id}:{item.CreationTime.UtcTicks}"));
            if (fingerprint == _lastSnapshotFingerprint) return;

            var notifications = new List<object>(ordered.Count);
            foreach (var notification in ordered)
            {
                try
                {
                    var projected = await ProjectAsync(notification);
                    if (projected is not null) notifications.Add(projected);
                }
                catch
                {
                    // A malformed notification must not prevent the rest of the snapshot.
                }
            }
            if (!_disposed && _notifications.IsCurrent(version))
            {
                _lastSnapshotFingerprint = fingerprint;
                Write(new { type = "snapshot", notifications });
            }
        }
        catch (Exception error)
        {
            WriteError(error.Message);
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task<object?> ProjectAsync(UserNotification notification)
    {
        var displayInfo = notification.AppInfo.DisplayInfo;
        var appName = Limit(displayInfo.DisplayName?.Trim() ?? string.Empty, 128);
        var appId = Limit(notification.AppInfo.AppUserModelId?.Trim() ?? appName, 512);
        if (appName.Length == 0 || appId.Length == 0) return null;

        var binding = notification.Notification.Visual.GetBinding(KnownNotificationBindings.ToastGeneric);
        var textElements = binding?.GetTextElements();
        var title = Limit(textElements?.FirstOrDefault()?.Text ?? string.Empty, 256);
        var body = Limit(string.Join("\n", textElements?.Skip(1).Select(item => item.Text) ?? []), 2048);
        if (!_iconCache.TryGetValue(appId, out var icon))
        {
            icon = await ReadIconAsync(displayInfo.GetLogo(new Windows.Foundation.Size(32, 32)));
            if (_iconCache.Count >= 100) _iconCache.Clear();
            _iconCache[appId] = icon;
        }

        return new
        {
            platformId = notification.Id,
            appId,
            appName,
            icon,
            title,
            body,
            createdAt = notification.CreationTime.UtcDateTime.ToString("O")
        };
    }

    private static async Task<string?> ReadIconAsync(RandomAccessStreamReference? reference)
    {
        if (reference is null) return null;
        using var stream = await reference.OpenReadAsync();
        if (stream.Size is 0 or > 96_000) return null;
        using var reader = new DataReader(stream.GetInputStreamAt(0));
        var length = await reader.LoadAsync((uint)stream.Size);
        var bytes = new byte[length];
        reader.ReadBytes(bytes);
        return $"data:image/png;base64,{Convert.ToBase64String(bytes)}";
    }

    private void WriteStatus()
    {
        Write(new { type = "status", status = AccessStatusName(_listener.GetAccessStatus()) });
    }

    private void WriteSuppression()
    {
        var result = NativeMethods.SHQueryUserNotificationState(out var state);
        Write(new { type = "suppression", state = result == 0 ? SuppressionName(state) : "unknown" });
    }

    private void WriteError(string message)
    {
        Write(new { type = "error", message = Limit(message, 500) });
    }

    private void Write(object value)
    {
        lock (_writeLock)
        {
            Console.Out.WriteLine(JsonSerializer.Serialize(value));
            Console.Out.Flush();
        }
    }

    private void Exit()
    {
        if (_disposed || _dispatcher.IsDisposed || !_dispatcher.IsHandleCreated) return;
        try { _dispatcher.BeginInvoke(ExitThread); }
        catch (ObjectDisposedException) { }
        catch (InvalidOperationException) { }
    }

    protected override void ExitThreadCore()
    {
        Dispose();
        base.ExitThreadCore();
    }

    public new void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            try { _listener.NotificationChanged -= OnPlatformNotificationChanged; }
            catch { }
        }
        Stop();
        _notifyDebounceTimer.Dispose();
        _statusTimer.Dispose();
        _desktopPopups.Dispose();
        _clipboardArchive.Dispose();
        _syncLock.Dispose();
        _dispatcher.Dispose();
        base.Dispose();
    }

    internal static string AccessStatusName(UserNotificationListenerAccessStatus status) => status switch
    {
        UserNotificationListenerAccessStatus.Allowed => "allowed",
        UserNotificationListenerAccessStatus.Denied => "denied",
        _ => "unspecified"
    };

    internal static string SuppressionName(QueryUserNotificationState state) => state switch
    {
        QueryUserNotificationState.NotPresent => "locked",
        QueryUserNotificationState.Busy => "busy",
        QueryUserNotificationState.RunningD3dFullScreen => "fullscreen",
        QueryUserNotificationState.PresentationMode => "presentation",
        QueryUserNotificationState.AcceptsNotifications => "accepts",
        QueryUserNotificationState.QuietTime => "quiet",
        QueryUserNotificationState.App => "accepts",
        _ => "unknown"
    };

    internal static string Limit(string value, int length) => value.Length <= length ? value : value[..length];

    internal static bool IsPlatformUnavailable(Exception error) => error.HResult == unchecked((int)0x803E0105);

    private static async Task StartNotificationServiceAsync()
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -NonInteractive -Command \"Get-Service -Name 'WpnUserService_*' -ErrorAction SilentlyContinue | Where-Object Status -ne 'Running' | Start-Service -ErrorAction SilentlyContinue\"",
            UseShellExecute = false,
            CreateNoWindow = true
        });
        if (process is null) return;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
        }
    }
}

internal enum QueryUserNotificationState
{
    NotPresent = 1,
    Busy = 2,
    RunningD3dFullScreen = 3,
    PresentationMode = 4,
    AcceptsNotifications = 5,
    QuietTime = 6,
    App = 7
}

internal static partial class NativeMethods
{
    [DllImport("shell32.dll")]
    internal static extern int SHQueryUserNotificationState(out QueryUserNotificationState state);
}
