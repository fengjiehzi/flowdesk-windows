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

    private readonly Action<object> _write;
    private readonly object _queueLock = new();
    private ClipboardWindow? _window;
    private Task _writeQueue = Task.CompletedTask;
    private string? _rootPath;
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
    }

    private void Capture()
    {
        var rootPath = _rootPath;
        if (!_enabled || rootPath is null) return;
        try
        {
            var now = DateTime.Now;
            if (Clipboard.ContainsFileDropList())
            {
                var paths = Clipboard.GetFileDropList()
                    .Cast<string>()
                    .Where(path => File.Exists(path) && IsMediaFile(path))
                    .ToArray();
                if (paths.Length > 0) Enqueue(() => CopyMediaFiles(rootPath, paths, now));
                return;
            }

            if (Clipboard.ContainsImage())
            {
                using var image = Clipboard.GetImage();
                if (image is null) return;
                using var stream = new MemoryStream();
                image.Save(stream, ImageFormat.Png);
                var bytes = stream.ToArray();
                Enqueue(() => SaveBitmap(rootPath, bytes, now));
                return;
            }

            if (Clipboard.ContainsText(TextDataFormat.UnicodeText))
            {
                var text = Clipboard.GetText(TextDataFormat.UnicodeText);
                if (text.Length > 0) Enqueue(() => AppendText(rootPath, text, now));
            }
        }
        catch (Exception error)
        {
            WriteError(error);
        }
    }

    private void Enqueue(Action action)
    {
        lock (_queueLock)
        {
            _writeQueue = _writeQueue.ContinueWith(
                _ =>
                {
                    try
                    {
                        action();
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

    private void CopyMediaFiles(string rootPath, IEnumerable<string> sourcePaths, DateTime now)
    {
        var mediaDirectory = MediaDirectory(rootPath);
        Directory.CreateDirectory(mediaDirectory);
        foreach (var sourcePath in sourcePaths)
        {
            try
            {
                var targetPath = UniquePath(mediaDirectory, Path.GetFileName(sourcePath), now);
                File.Copy(sourcePath, targetPath);
            }
            catch (Exception error)
            {
                WriteError(error);
            }
        }
    }

    private static void SaveBitmap(string rootPath, byte[] bytes, DateTime now)
    {
        var mediaDirectory = MediaDirectory(rootPath);
        Directory.CreateDirectory(mediaDirectory);
        var targetPath = UniquePath(mediaDirectory, $"{now:yyyyMMdd_HHmmssfff}.png", now);
        File.WriteAllBytes(targetPath, bytes);
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
}
