using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using SmartDeskBox.Core;
using SmartDeskBox.Intelligence;

namespace SmartDeskBox.DesktopApp;

public partial class MainWindow : Window, INotifyPropertyChanged
{
    private readonly WorkspacePaths paths;
    private readonly SqliteCacheStore store;
    private readonly SafeOrganizerService organizer;
    private readonly System.Windows.Forms.NotifyIcon tray;
    private ClassificationPipeline pipeline;
    private List<ClassifiedItem> classified = [];
    private bool busy;
    private double boxWidth = 320;
    private Point dragStart;
    private ItemViewModel? dragItem;
    private DesktopSession? desktopSession;
    private bool exitRequested;
    public bool IsBusy => busy;
    public string? LastOperationError { get; private set; }
    public DesktopSession? Desktop => desktopSession;
    public ObservableCollection<CategoryBox> Boxes { get; } = [];
    public ObservableCollection<CategoryBox> FilteredBoxes { get; } = [];
    public InterfaceSettings Interface { get; private set; } = new();
    private string section = "All";
    private string? interfaceWarning;
    public double BoxWidth
    {
        get => boxWidth;
        private set { boxWidth = value; PropertyChanged?.Invoke(this, new(nameof(BoxWidth))); }
    }
    public event PropertyChangedEventHandler? PropertyChanged;

    public MainWindow() : this(WorkspacePaths.Discover(), true) { }

    public MainWindow(WorkspacePaths workspace, bool autoScan, bool embedded = false)
    {
        paths = workspace;
        store = new(paths.DatabasePath);
        organizer = new(paths, store);
        pipeline = new(store, LoadSettings());
        foreach (var info in Categories.All)
            Boxes.Add(new(info, store.GetLayout(info.Category)?.IsCollapsed ?? false));
        InitializeComponent();
        try { Interface = InterfaceSettings.Load(paths); }
        catch (Exception ex) when (ex is IOException or JsonException or ArgumentException or UnauthorizedAccessException)
        { interfaceWarning = "界面配置读取失败，暂用默认设置：" + ex.Message; StatusText.Text = interfaceWarning; }
        InterfaceTheme.Apply(Interface);
        Microsoft.Win32.SystemEvents.UserPreferenceChanged += SystemThemeChanged;
        DataContext = this;
        ApplyFilters();
        tray = new System.Windows.Forms.NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application, Text = "SmartDeskBox · 桌面分区", Visible = !embedded
        };
        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add("显示桌面分区", null, async (_, _) => await Dispatcher.InvokeAsync(ShowDesktopAsync));
        menu.Items.Add("恢复原桌面图标", null, (_, _) => Dispatcher.Invoke(() => desktopSession?.Hide()));
        menu.Items.Add("重新扫描", null, async (_, _) => await Dispatcher.InvokeAsync(RefreshDesktopAsync));
        menu.Items.Add("管理面板", null, (_, _) => Dispatcher.Invoke(RestoreWindow));
        menu.Items.Add("设置", null, (_, _) => Dispatcher.Invoke(() => Settings_Click(this, new RoutedEventArgs())));
        menu.Items.Add("退出并恢复桌面", null, (_, _) => Dispatcher.Invoke(ExitDesktop));
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += async (_, _) => await Dispatcher.InvokeAsync(ShowDesktopAsync);
        if (embedded) Title = "灵动岛 · 桌面整理";
        StateChanged += (_, _) => { if (WindowState == WindowState.Minimized) Hide(); };
        SourceInitialized += (_, _) => ApplyNativeBackdrop();
        Closing += (_, e) =>
        {
            if (busy || desktopSession?.Windows.Any(window => window.HasActiveInteraction) == true) { e.Cancel = true; StatusText.Text = "操作正在进行，请完成后关闭窗口。"; return; }
            if (desktopSession != null && !exitRequested) { e.Cancel = true; Hide(); return; }
            try { SaveLayouts(); }
            catch (Exception ex) when (ex is IOException or Microsoft.Data.Sqlite.SqliteException)
            { StatusText.Text = "布局保存失败：" + ex.Message; }
        };
        Closed += (_, _) =>
        {
            Microsoft.Win32.SystemEvents.UserPreferenceChanged -= SystemThemeChanged;
            desktopSession?.Dispose();
            tray.Visible = false; tray.ContextMenuStrip?.Dispose(); tray.Dispose();
            if (desktopSession != null) Application.Current.Shutdown();
        };
        if (autoScan) Loaded += async (_, _) => await ScanAsync();
        else if (!StatusText.Text.StartsWith("界面配置")) StatusText.Text = "就绪 · 分类不搬动文件，手动文件操作作用于原文件";
    }

    public async Task StartDesktopAsync(string? executablePath = null, bool show = true)
    {
        desktopSession = new(this, store, executablePath ?? Path.Combine(AppContext.BaseDirectory, "SmartDeskBox.DesktopApp.exe"), Path.Combine(paths.Root, "data", "shell-views"), Interface);
        await ScanAsync();
        if (show) await ShowDesktopAsync();
    }

    public Task RefreshDesktopAsync() => ScanAsync();
    public Task ReclassifyDesktopAsync(ItemViewModel item, AppCategory category) => ReclassifyAsync(item, category);
    public void SetDesktopStatus(string text) => StatusText.Text = text;

    private Task ShowDesktopAsync() => RunActionAsync("正在显示桌面分区…", () =>
    {
        desktopSession?.Show();
        return Task.CompletedTask;
    });

    public void ExitDesktop()
    {
        if (busy || desktopSession?.Windows.Any(window => window.HasActiveInteraction) == true) { StatusText.Text = "请等待当前操作完成后退出。"; return; }
        exitRequested = true;
        Close();
    }

    public void ShowDesktopMenu(FrameworkElement target)
    {
        var menu = new ContextMenu();
        void Add(string name, Action action)
        {
            var item = new MenuItem { Header = name };
            item.Click += (_, _) => action();
            menu.Items.Add(item);
        }
        if (Window.GetWindow(target) is DesktopBoxWindow current)
        {
            Add(current.Box.IsCollapsed ? "展开当前区块" : "折叠当前区块", () => current.Box.IsCollapsed = !current.Box.IsCollapsed);
            var locked = new MenuItem { Header = "锁定全部区块布局", IsCheckable = true, IsChecked = Interface.LockLayout };
            locked.Click += (_, _) => SaveQuickSettings(Interface with { LockLayout = locked.IsChecked });
            menu.Items.Add(locked);
            var snap = new MenuItem { Header = "吸附对齐", IsCheckable = true, IsChecked = Interface.SnapEnabled };
            snap.Click += (_, _) => SaveQuickSettings(Interface with { SnapEnabled = snap.IsChecked });
            menu.Items.Add(snap);
            current.AddClassificationMenu(menu);
            menu.Items.Add(new Separator());
        }
        var scan = new MenuItem { Header = "重新扫描桌面" };
        scan.Click += async (_, _) => await ScanAsync();
        menu.Items.Add(scan);
        Add("打开管理面板", RestoreWindow);
        Add("设置", () => Settings_Click(this, new RoutedEventArgs()));
        Add("恢复默认分区布局", () => desktopSession?.ResetLayout());
        Add("恢复原桌面图标", () => desktopSession?.Hide());
        Add("退出并恢复桌面", ExitDesktop);
        menu.PlacementTarget = target;
        menu.IsOpen = true;
    }

    private LlmSettings LoadSettings()
    {
        try { return LlmSettings.Load(paths); }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        { return new(); }
    }

    public void DisplayItems(List<ClassifiedItem> items)
    {
        classified = items;
        foreach (var box in Boxes)
        {
            box.Items.Clear();
            foreach (var item in classified.Where(x => x.Result.Category == box.Info.Category)) box.Items.Add(new(item));
        }
        TotalText.Text = classified.Count.ToString("D2");
        AllCount.Text = classified.Count.ToString();
        AppsCount.Text = classified.Count(item => !Categories.Get(item.Result.Category).IsFile).ToString();
        FilesCount.Text = classified.Count(item => Categories.Get(item.Result.Category).IsFile).ToString();
        PendingCount.Text = classified.Count(item => item.Result.Category == AppCategory.PENDING).ToString();
        ApplyFilters();
        desktopSession?.Refresh();
    }

    private async Task RunActionAsync(string message, Func<Task> action)
    {
        if (busy) return;
        busy = true;
        LastOperationError = null;
        ActionsPanel.IsEnabled = false;
        SettingsButton.IsEnabled = false;
        BoxesControl.IsEnabled = false;
        EmptyActionButton.IsEnabled = DataPanel.IsEnabled = false;
        if (desktopSession != null) foreach (var window in desktopSession.Windows) window.IsEnabled = false;
        BusyProgress.Visibility = Visibility.Visible;
        StatusText.Text = message;
        try { await action(); }
        catch (Exception ex)
        {
            LastOperationError = ex.Message;
            StatusText.Text = "操作未完成：" + ex.Message;
            MessageBox.Show(this, ex.Message, "SmartDeskBox", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally
        {
            busy = false;
            ActionsPanel.IsEnabled = SettingsButton.IsEnabled = BoxesControl.IsEnabled = true;
            EmptyActionButton.IsEnabled = DataPanel.IsEnabled = true;
            if (desktopSession != null) foreach (var window in desktopSession.Windows) window.IsEnabled = true;
            BusyProgress.Visibility = Visibility.Collapsed;
        }
    }

    private Task ScanAsync() => RunActionAsync("正在只读扫描桌面与提取应用特征…", ScanCoreAsync);

    private async Task ScanCoreAsync()
    {
        var scan = await Task.Run(() => new MetadataExtractor().ScanRealDesktop());
        var items = await Task.Run(() => pipeline.ClassifyAsync(scan.Items));
        DisplayItems(items);
        var warnings = scan.Warnings.Concat(pipeline.Diagnostics).ToList();
        if (interfaceWarning is not null) warnings.Add(interfaceWarning);
        EngineText.Text = items.Any(i => i.Result.HitTier == "L3_LLM") ? "AI 增强 · 离线优先" : "离线分类";
        StatusText.Text = $"已扫描 {items.Count} 项 · {DateTime.Now:HH:mm} 更新 · 双击打开，右键或拖拽更改分类" +
            (warnings.Count > 0 ? $" · {warnings.Count} 条提示（悬浮查看）" : "");
        StatusText.ToolTip = warnings.Count > 0 ? string.Join("\n", warnings) : null;
    }

    private async void Scan_Click(object sender, RoutedEventArgs e) => await ScanAsync();

    private async void Organize_Click(object sender, RoutedEventArgs e) => await RunActionAsync("正在生成沙盒副本与校验备份…", async () =>
    {
        if (classified.Count == 0) { StatusText.Text = "暂无桌面项目，请先重新扫描。"; return; }
        var report = await organizer.OrganizeDesktopAsync(classified);
        var summary = $"批次 {report.BatchId} 已完成：复制 {report.CopiedCount} 项，轻量映射 {report.PlaceholderCount} 项。";
        StatusText.Text = summary + "  原始桌面保持完整。";
        MessageBox.Show(this, summary + "\n\n沙盒位置：" + report.SandboxPath, "备份完成", MessageBoxButton.OK, MessageBoxImage.Information);
    });

    private async void Rollback_Click(object sender, RoutedEventArgs e) => await RunActionAsync("正在校验并撤销上次沙盒备份…", async () =>
    {
        var report = await organizer.RollbackBatchAsync();
        StatusText.Text = report.BatchId == null ? "没有可撤销的备份批次。" :
            $"已撤销批次 {report.BatchId} 的 {report.RemovedCount} 项沙盒副本 · 原始备份继续保留";
    });

    private void Settings_Click(object sender, RoutedEventArgs e)
    {
        if (busy || desktopSession?.Windows.Any(window => window.HasActiveInteraction) == true) return;
        RestoreWindow();
        var dialog = new SettingsWindow(paths, LoadSettings(), classified, Interface) { Owner = this };
        if (dialog.ShowDialog() == true)
        {
            pipeline = new(store, dialog.Settings);
            ApplyInterfaceSettings(dialog.Interface);
            StatusText.Text = "设置已保存并应用。AI 配置用于下次扫描中尚未识别的项目。";
        }
    }

    private void Collapse_Click(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is not CategoryBox box) return;
        box.IsCollapsed = !box.IsCollapsed;
        SaveLayout(box);
    }

    private void Canvas_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var available = Math.Max(280, CanvasScroll.ActualWidth - 18);
        var columns = Math.Max(1, (int)(available / 290));
        BoxWidth = Math.Floor(available / columns) - 12;
    }

    private void Item_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (FindItem(e.OriginalSource as DependencyObject) is not { } item) return;
        try { Process.Start(new ProcessStartInfo(item.Item.Metadata.SourceFilePath) { UseShellExecute = true }); }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        { StatusText.Text = "无法打开项目：" + ex.Message; }
    }

    private void Item_ContextMenuOpening(object sender, ContextMenuEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is not ItemViewModel item) return;
        var menu = new ContextMenu();
        var parent = new MenuItem { Header = "更改分类（不移动文件）" };
        foreach (var info in Categories.All.Where(c => c.IsFile == Categories.Get(item.Item.Result.Category).IsFile))
        {
            var option = new MenuItem { Header = info.Name, IsChecked = item.Item.Result.Category == info.Category };
            option.Click += async (_, _) => await ReclassifyAsync(item, info.Category);
            parent.Items.Add(option);
        }
        menu.Items.Add(parent);
        ((FrameworkElement)sender).ContextMenu = menu;
    }

    private void Item_MouseDown(object sender, MouseButtonEventArgs e)
    {
        dragStart = e.GetPosition(this);
        dragItem = FindItem(e.OriginalSource as DependencyObject);
    }

    private void Item_MouseMove(object sender, MouseEventArgs e)
    {
        if (busy || e.LeftButton != MouseButtonState.Pressed || dragItem == null) return;
        var position = e.GetPosition(this);
        if (Math.Abs(position.X - dragStart.X) < SystemParameters.MinimumHorizontalDragDistance &&
            Math.Abs(position.Y - dragStart.Y) < SystemParameters.MinimumVerticalDragDistance) return;
        var item = dragItem;
        dragItem = null;
        DragDrop.DoDragDrop((DependencyObject)sender, new DataObject(typeof(ItemViewModel), item), DragDropEffects.Move);
    }

    private void Box_DragOver(object sender, DragEventArgs e)
    {
        e.Effects = !busy && e.Data.GetData(typeof(ItemViewModel)) is ItemViewModel item &&
            ((FrameworkElement)sender).DataContext is CategoryBox box && Categories.Get(item.Item.Result.Category).IsFile == box.IsFile
            ? DragDropEffects.Move : DragDropEffects.None;
        e.Handled = true;
    }

    private async void Box_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(typeof(ItemViewModel)) is ItemViewModel item && ((FrameworkElement)sender).DataContext is CategoryBox box)
            await ReclassifyAsync(item, box.Info.Category);
        e.Handled = true;
    }

    private Task ReclassifyAsync(ItemViewModel item, AppCategory category) => RunActionAsync("正在保存分类偏好…", async () =>
    {
        if (Categories.Get(category).IsFile != Categories.Get(item.Item.Result.Category).IsFile)
        { StatusText.Text = "应用与文件分别分类，请拖入同类分区。"; return; }
        var related = classified.Where(x => x.Metadata.ItemId == item.Item.Metadata.ItemId).ToList();
        foreach (var entry in related) await organizer.ReclassifySandboxAsync(entry.Metadata, category);
        var result = pipeline.SetManual(item.Item.Metadata, category);
        DisplayItems(classified.Select(entry => entry.Metadata.ItemId == result.ItemId
            ? entry with { Result = result with { ItemId = entry.Metadata.ItemId } } : entry).ToList());
        StatusText.Text = $"“{item.Name}”已归入{Categories.Get(category).Name} · 已记住偏好并同步沙盒副本";
    });

    internal static ItemViewModel? FindItem(DependencyObject? source)
    {
        while (source != null)
        {
            if (source is FrameworkElement { DataContext: ItemViewModel item }) return item;
            source = source is Visual || source is System.Windows.Media.Media3D.Visual3D
                ? VisualTreeHelper.GetParent(source) : LogicalTreeHelper.GetParent(source);
        }
        return null;
    }

    private void SaveLayouts()
    {
        if (desktopSession != null) desktopSession.SaveAll();
        else foreach (var box in Boxes) SaveLayout(box);
    }

    private void SaveLayout(CategoryBox box)
    {
        if (desktopSession != null)
        {
            var window = desktopSession.Windows.FirstOrDefault(w => w.Box == box);
            if (window != null) desktopSession.Save(window);
            return;
        }
        var handle = new WindowInteropHelper(this).Handle;
        var screen = System.Windows.Forms.Screen.FromHandle(handle);
        var index = Boxes.IndexOf(box);
        var columns = Math.Max(1, (int)((CanvasScroll.ActualWidth - 18) / (BoxWidth + 12)));
        store.SaveLayout(new(box.Info.Category, screen.DeviceName, (double)(index % columns) / columns,
            (double)(index / columns) / Math.Max(1, (int)Math.Ceiling(8.0 / columns)),
            BoxWidth / Math.Max(1, CanvasScroll.ActualWidth), box.BoxHeight / Math.Max(1, CanvasScroll.ActualHeight), box.IsCollapsed));
    }

    private void RestoreWindow() { Show(); WindowState = WindowState.Normal; Activate(); }

    private void ApplyNativeBackdrop() => InterfaceTheme.ApplyChrome(this);
}
