using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;
using SmartDeskBox.Core;

namespace SmartDeskBox.DesktopApp;

public sealed class DesktopSession : IDisposable
{
    private readonly MainWindow owner;
    private readonly SqliteCacheStore store;
    private readonly string executablePath;
    private readonly string stateDirectory;
    private readonly DispatcherTimer shellTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    private readonly DispatcherTimer scanTimer = new() { Interval = TimeSpan.FromMilliseconds(900) };
    private readonly List<FileSystemWatcher> watchers = [];
    private DesktopIconLease? icons;
    private bool disposed;
    private bool layoutRefreshPending;
    public List<DesktopBoxWindow> Windows { get; } = [];
    public bool IsActive { get; private set; }
    private InterfaceSettings settings;
    private List<CategoryBox> ActiveBoxes => owner.Boxes.Where(b => !settings.HideEmpty || b.Items.Count > 0).ToList();

    public DesktopSession(MainWindow owner, SqliteCacheStore store, string executablePath, string stateDirectory, InterfaceSettings? settings = null)
    {
        this.owner = owner;
        this.store = store;
        this.executablePath = executablePath;
        this.stateDirectory = stateDirectory;
        this.settings = settings ?? new();
        shellTimer.Tick += (_, _) =>
        {
            if (!IsActive || Windows.Any(window => window.HasActiveInteraction) ||
                (!layoutRefreshPending && Windows.Count == ActiveBoxes.Count && Windows.All(w => w.IsDesktopAttached))) return;
            try { Rebuild(false); }
            catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or IOException)
            { owner.SetDesktopStatus("桌面宿主暂不可用，将自动重试：" + ex.Message); }
        };
        scanTimer.Tick += async (_, _) =>
        {
            if (owner.IsBusy || Windows.Any(window => window.HasActiveInteraction || window.ShellView.IsEditing || window.ShellView.HasPendingImports)) return;
            scanTimer.Stop();
            await owner.RefreshDesktopAsync();
        };
        foreach (var path in new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)
        }.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(path)) continue;
            var watcher = new FileSystemWatcher(path) { NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite, EnableRaisingEvents = true };
            watcher.Created += Changed; watcher.Deleted += Changed; watcher.Renamed += Renamed; watcher.Changed += Changed;
            watcher.Error += (_, _) => QueueScan();
            watchers.Add(watcher);
        }
        SystemEvents.DisplaySettingsChanged += DisplayChanged;
        shellTimer.Start();
    }

    public void Show()
    {
        if (IsActive && Windows.Count == ActiveBoxes.Count && Windows.All(w => w.IsDesktopAttached)) return;
        Rebuild(false);
    }

    public void Refresh()
    {
        if (IsActive && !Windows.Select(w => w.Box.Info.Category).ToHashSet().SetEquals(ActiveBoxes.Select(b => b.Info.Category)))
            Rebuild(false);
    }

    public void ResetLayout() => Rebuild(true);

    public void ApplySettings(InterfaceSettings value)
    {
        settings = value;
        if (!settings.AutoRefresh) scanTimer.Stop();
        foreach (var window in Windows) window.ApplySettings(value);
        Refresh();
    }

    private void Rebuild(bool reset)
    {
        if (Windows.Any(window => window.HasActiveInteraction)) { layoutRefreshPending = true; return; }
        layoutRefreshPending = false;
        var (host, iconWindow) = DesktopNative.FindDesktop();
        CloseWindows();
        try
        {
            var active = ActiveBoxes;
            if (active.Count == 0) { IsActive = false; owner.SetDesktopStatus("桌面没有可分类项目，系统图标保持显示。"); return; }
            var plan = DesktopLayout.Plan(active);
            foreach (var box in active)
            {
                var window = new DesktopBoxWindow(box, owner.ReclassifyDesktopAsync, Save, owner.ShowDesktopMenu,
                    statePath: Path.Combine(stateDirectory, box.Info.Category + ".json"))
                { ResetClassification = owner.ResetClassificationAsync };
                window.ApplySettings(settings);
                window.SnapNeighbors = () => Windows.Where(other => other != window && !other.IsClosed && other.IsVisible)
                    .Select(other => DesktopNative.Bounds(other.Handle)).ToArray();
                Windows.Add(window);
                window.ShellView.AcceptNewItems = paths => owner.AcceptShellItemsAsync(paths, box.Info.Category);
                window.ShellView.InitializationFailed += exception =>
                {
                    Hide();
                    owner.SetDesktopStatus("Windows 文件视图启动失败，已恢复系统桌面：" + exception.Message);
                };
                window.Attach(host, DesktopLayout.Restore(reset ? null : store.GetLayout(box.Info.Category), plan[box.Info.Category]));
                Save(window);
            }
            icons = new(iconWindow, executablePath);
            IsActive = true;
        owner.SetDesktopStatus($"已显示 {active.Count} 个分区 · 分类不移动原文件");
        }
        catch { CloseWindows(); throw; }
    }

    public void Save(DesktopBoxWindow window)
    {
        if (!window.IsDesktopAttached) return;
        try { store.SaveLayout(DesktopLayout.Capture(window)); }
        catch (Microsoft.Data.Sqlite.SqliteException ex) { owner.SetDesktopStatus("分区位置保存失败：" + ex.Message); }
    }

    public void SaveAll() { foreach (var window in Windows) Save(window); }

    public void Hide()
    {
        if (Windows.Any(window => window.HasActiveInteraction)) { owner.SetDesktopStatus("桌面交互正在进行，请完成后恢复桌面。"); return; }
        SaveAll();
        IsActive = false;
        CloseWindows();
        owner.SetDesktopStatus("已退出桌面分区并恢复系统图标，原始文件保持完整。");
    }

    private void CloseWindows()
    {
        icons?.Dispose(); icons = null;
        foreach (var window in Windows) if (!window.IsClosed) window.Close();
        Windows.Clear();
    }

    private void Changed(object sender, FileSystemEventArgs e) => QueueScan();
    private void Renamed(object sender, RenamedEventArgs e)
    {
        try { store.TransferManual(e.OldFullPath, e.FullPath, true); }
        catch (Microsoft.Data.Sqlite.SqliteException exception)
        { owner.Dispatcher.BeginInvoke(() => owner.SetDesktopStatus("重命名后的分类记录更新失败：" + exception.Message)); }
        QueueScan();
    }
    private void QueueScan() => owner.Dispatcher.BeginInvoke(() =>
    {
        if (disposed || !settings.AutoRefresh) return;
        scanTimer.Stop(); scanTimer.Start();
    });

    private void DisplayChanged(object? sender, EventArgs e) => owner.Dispatcher.BeginInvoke(() =>
    {
        if (disposed || !IsActive) return;
        try { Rebuild(false); }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or IOException)
        { owner.SetDesktopStatus("屏幕布局更新失败：" + ex.Message); }
    });

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        shellTimer.Stop(); scanTimer.Stop();
        SystemEvents.DisplaySettingsChanged -= DisplayChanged;
        foreach (var watcher in watchers) watcher.Dispose();
        Hide();
    }

}
