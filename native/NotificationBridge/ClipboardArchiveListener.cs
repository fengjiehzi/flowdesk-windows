using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace WindowsDynamicIsland.NotificationBridge;

internal sealed class ClipboardArchiveListener : IDisposable
{
    private static readonly HashSet<string> MediaExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".svg", ".heic", ".avif",
        ".mp4", ".mov", ".mkv", ".avi", ".wmv", ".webm", ".m4v", ".mpeg", ".mpg", ".3gp"
    };

    private const long MaxMediaCopyBytes = 50L * 1024 * 1024;
    private readonly Action<object> _write;
    private readonly object _queueLock = new();
    private ClipboardWindow? _window;
    private Task _writeQueue = Task.CompletedTask;
    private string? _rootPath;
    private uint _lastSequence;
    private string? _lastText;
    private DateTime _lastTextTime;
    private bool _enabled;
    private bool _disposed;

    public ClipboardArchiveListener(Action<object> write)
    {
        _write = write;
    }

    public void Configure(bool enabled, string rootPath)
    {
        if (_disposed) return;
        if (!enabled)
        {
            StopListening();
            return;
        }

        try
        {
            var fullPath = Path.GetFullPath(rootPath);
            Directory.CreateDirectory(fullPath);
            Directory.CreateDirectory(MediaDirectory(fullPath));
            _rootPath = fullPath;
            _enabled = true;
            _window ??= new ClipboardWindow(Capture);
            _write(new { type = "clipboardArchiveStatus", enabled = true });
        }
        catch (Exception error)
        {
            StopListening();
            WriteError(error);
        }
    }

    public Task StopAndFlushAsync()
    {
        StopListening();
        lock (_queueLock) return _writeQueue;
    }

    private void StopListening()
    {
        _enabled = false;
        _rootPath = null;
        _window?.Dispose();
        _window = null;
        _write(new { type = "clipboardArchiveStatus", enabled = false });
    }

    private void Capture()
    {
        var rootPath = _rootPath;
        if (!_enabled || rootPath is null) return;
        var sequence = NativeMethods.GetClipboardSequenceNumber();
        if (sequence != 0 && sequence == _lastSequence) return;
        _lastSequence = sequence;
        try
        {
            var data = Clipboard.GetDataObject();
            if (data is null) return;
            // 遵守 Windows 11 剪贴板隐私标记，跳过密码管理器等敏感内容。
            if (data.GetDataPresent("ExcludeClipboardContentFromMonitorProcessing")) return;
            if (data.GetDataPresent("CanIncludeInClipboardHistory")
                && data.GetData("CanIncludeInClipboardHistory") is MemoryStream historyFlag
                && historyFlag.Length > 0 && historyFlag.ToArray()[0] == 0)
            {
                return;
            }

            var now = DateTime.Now;
            var createdIso = now.ToUniversalTime().ToString("O");
            if (data.GetDataPresent(DataFormats.FileDrop) && data.GetData(DataFormats.FileDrop) is string[] dropPaths)
            {
                var paths = dropPaths
                    .Where(path =>
                    {
                        try
                        {
                            if (!File.Exists(path) || !IsMediaFile(path)) return false;
                            var length = new FileInfo(path).Length;
                            return length > 0 && length <= MaxMediaCopyBytes;
                        }
                        catch { return false; }
                    })
                    .ToArray();
                if (paths.Length > 0) Enqueue(() =>
                {
                    var copiedPath = CopyMediaFiles(rootPath, paths, now);
                    return new
                    {
                        id = Guid.NewGuid().ToString(),
                        kind = "file",
                        preview = paths.Length == 1 ? Path.GetFileName(paths[0]) : $"{Path.GetFileName(paths[0])} 等 {paths.Length} 个媒体文件",
                        filePath = copiedPath,
                        createdAt = createdIso
                    };
                });
                return;
            }

            if (data.GetDataPresent(DataFormats.Bitmap) && data.GetData(DataFormats.Bitmap) is System.Drawing.Bitmap bitmap)
            {
                var copy = new System.Drawing.Bitmap(bitmap);
                Enqueue(() =>
                {
                    using (copy)
                    {
                        using var stream = new MemoryStream();
                        copy.Save(stream, ImageFormat.Png);
                        var savedPath = SaveBitmap(rootPath, stream.ToArray(), now);
                        var thumbWidth = Math.Max(1, Math.Min(96, copy.Width));
                        var thumbHeight = Math.Max(1, (int)Math.Round(copy.Height * (thumbWidth / (double)Math.Max(1, copy.Width))));
                        using var thumb = new System.Drawing.Bitmap(copy, new System.Drawing.Size(thumbWidth, thumbHeight));
                        using var thumbStream = new MemoryStream();
                        thumb.Save(thumbStream, ImageFormat.Png);
                        return new
                        {
                            id = Guid.NewGuid().ToString(),
                            kind = "image",
                            preview = $"截图 ({copy.Width}×{copy.Height})",
                            filePath = savedPath,
                            thumbnail = "data:image/png;base64," + Convert.ToBase64String(thumbStream.ToArray()),
                            createdAt = createdIso
                        };
                    }
                });
                return;
            }

            if (data.GetDataPresent(DataFormats.UnicodeText) && data.GetData(DataFormats.UnicodeText) is string text && text.Length > 0)
            {
                if (_lastText == text && now - _lastTextTime < TimeSpan.FromSeconds(2)) return;
                _lastText = text;
                _lastTextTime = now;
                Enqueue(() =>
                {
                    AppendText(rootPath, text, now);
                    var normalized = text.Replace("\r\n", " ").Replace('\n', ' ').Trim();
                    return new
                    {
                        id = Guid.NewGuid().ToString(),
                        kind = "text",
                        preview = normalized.Length <= 140 ? normalized : normalized[..140] + "…",
                        text = text.Length <= 16_000 ? text : text[..16_000],
                        createdAt = createdIso
                    };
                });
            }
        }
        catch (ExternalException)
        {
            // 其他前台应用正占用剪贴板锁，静默跳过避免冲突报错弹窗。
        }
        catch (Exception error)
        {
            WriteError(error);
        }
    }

    private void Enqueue(Func<object> action)
    {
        lock (_queueLock)
        {
            _writeQueue = _writeQueue.ContinueWith(
                _ =>
                {
                    try
                    {
                        var item = action();
                        _write(new { type = "clipboardArchiveSaved", item });
                    }
                    catch (Exception error)
                    {
                        WriteError(error);
                    }
                },
                CancellationToken.None,
                TaskContinuationOptions.None,
                TaskScheduler.Default
            );
        }
    }

    private static void AppendText(string rootPath, string text, DateTime now)
    {
        Directory.CreateDirectory(rootPath);
        File.AppendAllText(
            Path.Combine(rootPath, TextFileName(now)),
            FormatTextEntry(text, now),
            new UTF8Encoding(false)
        );
    }

    private string? CopyMediaFiles(string rootPath, IEnumerable<string> sourcePaths, DateTime now)
    {
        Exception? failure = null;
        string? firstTarget = null;
        var mediaDirectory = MediaDirectory(rootPath);
        Directory.CreateDirectory(mediaDirectory);
        foreach (var sourcePath in sourcePaths)
        {
            try
            {
                var targetPath = UniquePath(mediaDirectory, Path.GetFileName(sourcePath), now);
                File.Copy(sourcePath, targetPath);
                firstTarget ??= targetPath;
            }
            catch (Exception error)
            {
                failure = error;
            }
        }
        if (failure is not null) throw failure;
        return firstTarget;
    }

    private static string SaveBitmap(string rootPath, byte[] bytes, DateTime now)
    {
        var mediaDirectory = MediaDirectory(rootPath);
        Directory.CreateDirectory(mediaDirectory);
        var targetPath = UniquePath(mediaDirectory, $"{now:yyyyMMdd_HHmmssfff}.png", now);
        File.WriteAllBytes(targetPath, bytes);
        return targetPath;
    }

    private void WriteError(Exception error)
    {
        var message = error.Message.Length <= 500 ? error.Message : error.Message[..500];
        _write(new { type = "clipboardArchiveError", message });
    }

    internal static bool IsMediaFile(string path) => MediaExtensions.Contains(Path.GetExtension(path));

    internal static string TextFileName(DateTime now) => $"{now:yyyy-MM-dd}.txt";

    internal static string FormatTextEntry(string text, DateTime now) =>
        $"[{now:HH:mm:ss.fff}]{Environment.NewLine}{text}{Environment.NewLine}{Environment.NewLine}";

    internal static string CollisionFileName(string fileName, DateTime now, int suffix = 0)
    {
        var extension = Path.GetExtension(fileName);
        var name = Path.GetFileNameWithoutExtension(fileName);
        var counter = suffix > 0 ? $"_{suffix}" : string.Empty;
        return $"{name}_{now:yyyyMMdd_HHmmssfff}{counter}{extension}";
    }

    private static string UniquePath(string directory, string fileName, DateTime now)
    {
        var path = Path.Combine(directory, fileName);
        if (!File.Exists(path)) return path;
        for (var suffix = 0; ; suffix++)
        {
            path = Path.Combine(directory, CollisionFileName(fileName, now, suffix));
            if (!File.Exists(path)) return path;
        }
    }

    private static string MediaDirectory(string rootPath) => Path.Combine(rootPath, "媒体");

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopListening();
    }

    private sealed class ClipboardWindow : NativeWindow, IDisposable
    {
        private const int ClipboardUpdate = 0x031D;
        private readonly Action _changed;

        public ClipboardWindow(Action changed)
        {
            _changed = changed;
            CreateHandle(new CreateParams { Caption = "WindowsDynamicIsland.ClipboardArchive" });
            if (!NativeMethods.AddClipboardFormatListener(Handle))
            {
                DestroyHandle();
                throw new InvalidOperationException("Unable to register clipboard listener.");
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == ClipboardUpdate) _changed();
            base.WndProc(ref message);
        }

        public void Dispose()
        {
            if (Handle == IntPtr.Zero) return;
            NativeMethods.RemoveClipboardFormatListener(Handle);
            DestroyHandle();
        }
    }
}

internal static partial class NativeMethods
{
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool AddClipboardFormatListener(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

    [DllImport("user32.dll")]
    internal static extern uint GetClipboardSequenceNumber();
}
