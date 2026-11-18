using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;

namespace SmartDeskBox.DesktopApp;

// The inherited standard streams are private to the owning Electron process.
public sealed class IslandHost : IDisposable
{
    private readonly MainWindow window;
    private readonly bool probe;
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(1) };
    private string? previousState;
    private bool disposed;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    public IslandHost(MainWindow window, bool probe)
    {
        this.window = window;
        this.probe = probe;
        Console.InputEncoding = Console.OutputEncoding = new UTF8Encoding(false);
        timer.Tick += (_, _) => PublishState();
    }

    private object State() => new { running = true, active = window.Desktop?.IsActive == true, busy = window.IsBusy, error = window.LastOperationError };

    private static void Write(object message)
    {
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(message, JsonOptions));
            Console.Out.Flush();
        }
        catch (IOException) { }
    }

    public static void WriteStartupError(string error)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Write(new { ready = false, error, state = new { running = false, active = false, busy = false } });
    }

    public void Start()
    {
        Write(new { ready = true, state = State() });
        timer.Start();
        _ = Task.Run(ReadCommandsAsync);
    }

    private void PublishState()
    {
        var state = JsonSerializer.Serialize(State(), JsonOptions);
        if (state == previousState) return;
        previousState = state;
        Write(new { state = State() });
    }

    private static async Task<string?> ReadLineBoundedAsync(System.IO.TextReader reader, int maxChars)
    {
        var buffer = new StringBuilder(128);
        var ch = new char[1];
        var overflow = false;
        while (true)
        {
            var read = await reader.ReadAsync(ch, 0, 1).ConfigureAwait(false);
            if (read == 0) return buffer.Length == 0 && !overflow ? null : overflow ? new string(' ', maxChars + 1) : buffer.ToString();
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
            while (!disposed && await ReadLineBoundedAsync(Console.In, 1024).ConfigureAwait(false) is { } line)
            {
                int? id = null;
                try
                {
                    if (line.Length > 1024) throw new ArgumentException("命令过长。");
                    using var document = JsonDocument.Parse(line);
                    id = document.RootElement.GetProperty("id").GetInt32();
                    var action = document.RootElement.GetProperty("action").GetString();
                    var accent = document.RootElement.TryGetProperty("accent", out var accentNode) && accentNode.ValueKind == JsonValueKind.String
                        ? accentNode.GetString()
                        : null;
                    await window.Dispatcher.InvokeAsync(() => ExecuteAsync(id.Value, action, accent)).Task.Unwrap().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    await window.Dispatcher.InvokeAsync(() => Write(new { id, ok = false, error = ex.Message, state = State() }));
                }
            }
        }
        catch (IOException) { }
        finally
        {
            if (!disposed) await window.Dispatcher.InvokeAsync(ParentExited);
        }
    }

    private async Task ExecuteAsync(int id, string? action, string? accent = null)
    {
        if (action is not ("show" or "hide" or "manage" or "settings" or "refresh" or "state" or "theme" or "exit"))
            throw new ArgumentException("不支持的桌面整理命令。");
        if (action is not ("state" or "theme" or "exit") && (window.IsBusy || !window.IsEnabled || window.Desktop?.Windows.Any(box => box.HasActiveInteraction) == true))
            throw new InvalidOperationException("请先完成桌面文件操作或关闭设置窗口。");
        if (probe && action is not ("state" or "theme" or "exit")) throw new InvalidOperationException("协议测试不操作真实桌面。");
        if (action == "exit")
        {
            foreach (var owned in window.OwnedWindows.Cast<Window>().ToArray()) owned.Close();
        }
        switch (action)
        {
            case "show": window.Desktop?.Show(); break;
            case "hide": window.Desktop?.Hide(); break;
            case "manage": window.Show(); window.WindowState = WindowState.Normal; window.Activate(); break;
            case "theme":
                InterfaceTheme.SetIslandAccent(accent, window.Interface);
                break;
            case "settings":
                // A modal dialog must not prevent acknowledging this command.
                _ = window.Dispatcher.BeginInvoke(new Action(window.OpenIslandSettings));
                break;
            case "refresh":
                await window.RefreshDesktopAsync();
                if (window.LastOperationError != null) throw new IOException(window.LastOperationError);
                break;
        }
        Write(new { id, ok = true, state = State() });
        if (action == "exit") _ = window.Dispatcher.BeginInvoke(new Action(() =>
        {
            window.ExitDesktop();
            if (probe) Application.Current.Shutdown();
        }));
    }

    private void ParentExited()
    {
        // Allow an in-flight file operation to finish before disposing its Shell view.
        foreach (var owned in window.OwnedWindows.Cast<Window>().ToArray()) owned.Close();
        window.ExitDesktop();
        if (probe) Application.Current.Shutdown();
        timer.Tick += (_, _) => window.ExitDesktop();
    }

    public void Dispose() { disposed = true; timer.Stop(); }
}

public partial class MainWindow
{
    public void OpenIslandSettings() => Settings_Click(this, new RoutedEventArgs());
}
