using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Threading;
using static SmartDeskBox.DesktopApp.ShellViewInterop;

namespace SmartDeskBox.DesktopApp;

public sealed partial class DesktopShellView
{
    private DispatcherTimer? stateTimer;
    private DispatcherTimer? acceptTimer;
    private readonly HashSet<string> verifiedImports = new(StringComparer.OrdinalIgnoreCase);
    public Func<IReadOnlyList<string>, Task<bool>>? AcceptNewItems { get; set; }
    public bool IsEditing => FindDescendant(viewWindow, "Edit") != IntPtr.Zero;
    private volatile bool modelessDisabled;
    public bool HasActiveNativeOperation => nativeDropRunning || modelessDisabled || dropTarget?.IsDragging == true || categoryDropTimer?.IsEnabled == true;
    public bool HasPendingImports => HasActiveNativeOperation || acceptTimer?.IsEnabled == true || editTimer?.IsEnabled == true;
    private sealed record IconPosition(int X, int Y);
    private sealed record IconState(uint Mode, Dictionary<string, IconPosition> Positions);

    private void QueueAcceptedSelection()
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.BeginInvoke(QueueAcceptedSelection); return; }
        if (AcceptNewItems is null || viewWindow == IntPtr.Zero) return;
        acceptTimer ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
        if (acceptTimer.IsEnabled) return;
        acceptTimer.Tick -= AcceptSelection;
        acceptTimer.Tick += AcceptSelection;
        acceptTimer.Start();
    }

    private async void AcceptSelection(object? sender, EventArgs args)
    {
        if (HasActiveNativeOperation || IsEditing || editTimer?.IsEnabled == true) return;
        acceptTimer!.Stop();
        try
        {
            var selected = SelectedPaths().Concat(verifiedImports).Distinct(StringComparer.OrdinalIgnoreCase)
                .Where(path => !included.Contains(path) && (File.Exists(path) || Directory.Exists(path))).ToArray();
            if (selected.Length == 0) return;
            if (AcceptNewItems is not null && !await AcceptNewItems(selected)) { acceptTimer.Start(); return; }
            verifiedImports.Clear();
            receivingNativeDrop = false;
        }
        catch (Exception exception) { Feedback?.Invoke("新项目分类未完成：" + exception.Message); }
    }

    private void SaveIconState()
    {
        if (statePath is null || view is not IFolderView items || stateTimer?.IsEnabled == true) return;
        try
        {
            items.GetCurrentViewMode(out uint mode);
            var positions = new Dictionary<string, IconPosition>(StringComparer.OrdinalIgnoreCase);
            var paths = VisiblePaths();
            for (int index = 0; index < paths.Count; index++)
            {
                items.Item(index, out IntPtr pidl);
                try { items.GetItemPosition(pidl, out var point); positions[paths[index]] = new(point.X, point.Y); }
                finally { Marshal.FreeCoTaskMem(pidl); }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(statePath)!);
            File.WriteAllText(statePath + ".tmp", JsonSerializer.Serialize(new IconState(mode, positions)));
            File.Move(statePath + ".tmp", statePath, true);
        }
        catch (Exception exception) when (exception is COMException or IOException or UnauthorizedAccessException)
        { Feedback?.Invoke("区块内部布局保存失败：" + exception.Message); }
    }

    private void StartRestoringState()
    {
        stateTimer?.Stop();
        if (statePath is null || !File.Exists(statePath)) return;
        IconState? saved;
        try { saved = JsonSerializer.Deserialize<IconState>(File.ReadAllText(statePath)); }
        catch (Exception exception) when (exception is JsonException or IOException or UnauthorizedAccessException)
        { Feedback?.Invoke("区块内部布局读取失败：" + exception.Message); return; }
        if (saved is null || saved.Positions is null) return;
        int attempts = 0;
        stateTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        stateTimer.Tick += (_, _) =>
        {
            if (view is not IFolderView items || ++attempts > 30) { stateTimer.Stop(); return; }
            var paths = VisiblePaths();
            if (paths.Count != included.Count) return;
            stateTimer.Stop();
            try
            {
                if (saved.Mode is >= 1 and <= 8) items.SetCurrentViewMode(saved.Mode);
                for (int index = 0; index < paths.Count; index++)
                {
                    if (!saved.Positions.TryGetValue(paths[index], out var position) || position.X < 0 || position.Y < 0) continue;
                    items.Item(index, out IntPtr pidl);
                    IntPtr pidlArray = Marshal.AllocHGlobal(IntPtr.Size), pointArray = Marshal.AllocHGlobal(8);
                    try
                    {
                        Marshal.WriteIntPtr(pidlArray, pidl); Marshal.WriteInt32(pointArray, position.X); Marshal.WriteInt32(pointArray, 4, position.Y);
                        items.SelectAndPositionItems(1, pidlArray, pointArray, 0x80000080);
                    }
                    finally { Marshal.FreeCoTaskMem(pidl); Marshal.FreeHGlobal(pidlArray); Marshal.FreeHGlobal(pointArray); }
                }
            }
            catch (COMException exception) { Feedback?.Invoke("区块内部布局恢复失败：" + exception.Message); }
        };
        stateTimer.Start();
    }
}
