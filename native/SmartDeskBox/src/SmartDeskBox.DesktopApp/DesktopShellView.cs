using System.Collections.Specialized;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;
using static SmartDeskBox.DesktopApp.ShellViewInterop;

namespace SmartDeskBox.DesktopApp;

public sealed partial class DesktopShellView : HwndHost
{
    private readonly CategoryBox box;
    private readonly string? folderPath;
    private readonly string? statePath;
    private readonly DispatcherTimer refreshTimer;
    private HashSet<string> included;
    private IShellFolder? folder;
    private IShellView? view;
    private Browser? browser;
    private IntPtr folderPidl, container, viewWindow;
    public IntPtr ViewHandle => viewWindow;
    public int FilterCalls { get; private set; }
    public Exception? InitializationError { get; private set; }
    public event Action<Exception>? InitializationFailed;
    internal IShellView NativeView => view ?? throw new InvalidOperationException("Windows 文件视图尚未就绪。");
    internal IShellFolder NativeFolder => folder ?? throw new InvalidOperationException("Windows 文件夹尚未就绪。");

    public DesktopShellView(CategoryBox box, string? folderPath = null, string? statePath = null)
    {
        this.box = box;
        this.folderPath = folderPath;
        this.statePath = statePath;
        included = Paths();
        refreshTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(150) };
        refreshTimer.Tick += (_, _) => { refreshTimer.Stop(); RefreshItems(); };
    }

    private HashSet<string> Paths() => box.Items.Select(item => item.Item.Metadata.SourceFilePath).ToHashSet(StringComparer.OrdinalIgnoreCase);

    protected override HandleRef BuildWindowCore(HandleRef parent)
    {
        container = CreateWindowEx(0, "Static", "", 0x50000000 | 0x02000000 | 0x04000000, 0, 0, 1, 1, parent.Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, () =>
        {
            if (container == IntPtr.Zero) return;
            try { CreateShellView(); }
            catch (Exception exception) { InitializationError = exception; ReleaseView(); InitializationFailed?.Invoke(exception); }
        });
        return new(this, container);
    }

    private void CreateShellView()
    {
        try
        {
            Marshal.ThrowExceptionForHR(SHGetDesktopFolder(out var desktop));
            if (folderPath is null)
            {
                folder = desktop;
                Marshal.ThrowExceptionForHR(SHGetSpecialFolderLocation(container, 0, out folderPidl));
            }
            else
            {
                try
                {
                    Marshal.ThrowExceptionForHR(SHParseDisplayName(folderPath, IntPtr.Zero, out folderPidl, 0, out _));
                    Guid folderId = typeof(IShellFolder).GUID;
                    desktop.BindToObject(folderPidl, IntPtr.Zero, ref folderId, out folder);
                }
                finally { Marshal.ReleaseComObject(desktop); }
            }
            Guid viewId = typeof(IShellView).GUID;
            folder.CreateViewObject(container, ref viewId, out var createdView);
            view = (IShellView)createdView;
            browser = new Browser(this);
            // Private view state prevents rearrangement or display choices from changing Explorer's desktop.
            var settings = new FolderSettings { Mode = 1, Flags = 0x10000000 | 0x1000000 | 0x100000 | 0x200 };
            var bounds = new ShellViewInterop.Rect { Right = Math.Max(1, (int)ActualWidth), Bottom = Math.Max(1, (int)ActualHeight) };
            view.CreateViewWindow(null, ref settings, browser, ref bounds, out viewWindow);
            if (GetClientRect(container, out var client)) MoveWindow(viewWindow, 0, 0, client.Right, client.Bottom, true);
            view.UIActivate(1);
            ShowWindow(viewWindow, 5);
            ApplyPalette();
            InterfaceTheme.Changed += ApplyPalette;
            InstallDropTarget();
            StartRestoringState();
            box.Items.CollectionChanged += ItemsChanged;
        }
        catch { ReleaseView(); throw; }
    }

    private void ItemsChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        included = Paths();
        refreshTimer.Stop(); refreshTimer.Start();
    }

    public void RefreshItems() { SaveIconState(); included = Paths(); view?.Refresh(); StartRestoringState(); }

    public IReadOnlyList<string> SelectedPaths()
    {
        if (view is not IFolderView items) return [];
        Guid enumId = typeof(IEnumIDList).GUID;
        IntPtr pointer;
        try { items.Items(1, ref enumId, out pointer); }
        catch (COMException exception) when (exception.HResult is unchecked((int)0x80004005) or unchecked((int)0x80070490)) { return []; }
        if (pointer == IntPtr.Zero) return [];
        var enumerator = (IEnumIDList)Marshal.GetObjectForIUnknown(pointer);
        Marshal.Release(pointer);
        try
        {
            var paths = new List<string>();
            while (enumerator.Next(1, out IntPtr pidl, out uint count) == 0 && count == 1)
            {
                try { if (PathFor(folderPidl, pidl) is { } path) paths.Add(path); }
                finally { Marshal.FreeCoTaskMem(pidl); }
            }
            return paths;
        }
        finally { Marshal.ReleaseComObject(enumerator); }
    }

    public void SelectPaths(IReadOnlyCollection<string> paths)
    {
        if (view is not IFolderView items) return;
        var visible = VisiblePaths();
        bool first = true;
        for (int index = 0; index < visible.Count; index++)
            if (paths.Contains(visible[index], StringComparer.OrdinalIgnoreCase))
            { items.SelectItem(index, 1u | 8 | (first ? 4u | 16 : 0)); first = false; }
    }

    public bool ContainsCursor() => GetCursorPos(out var point) && GetWindowRect(container, out var bounds) &&
        point.X >= bounds.Left && point.X < bounds.Right && point.Y >= bounds.Top && point.Y < bounds.Bottom;

    public IReadOnlyList<string> VisiblePaths()
    {
        if (view is not IFolderView items) return [];
        items.ItemCount(2, out int count);
        var paths = new List<string>();
        for (int index = 0; index < count; index++)
        {
            items.Item(index, out IntPtr pidl);
            try { if (PathFor(folderPidl, pidl) is { } path) paths.Add(path); }
            finally { Marshal.FreeCoTaskMem(pidl); }
        }
        return paths;
    }

    protected override void OnWindowPositionChanged(System.Windows.Rect bounds)
    {
        base.OnWindowPositionChanged(bounds);
        if (viewWindow != IntPtr.Zero && GetClientRect(container, out var client))
            MoveWindow(viewWindow, 0, 0, client.Right, client.Bottom, true);
    }

    protected override bool TabIntoCore(TraversalRequest request)
    {
        view?.UIActivate(2);
        SetFocus(FindDescendant(viewWindow, "SysListView32"));
        return true;
    }

    protected override bool TranslateAcceleratorCore(ref MSG message, ModifierKeys modifiers)
    {
        if (view?.TranslateAccelerator(ref message) == 0) return true;
        if (message.message == 0x100 && message.wParam == new IntPtr(0x4e) && modifiers == (ModifierKeys.Control | ModifierKeys.Shift))
        { InvokeNativeCommand("NewFolder", true); return true; }
        return false;
    }

    protected override void DestroyWindowCore(HandleRef handle)
    {
        box.Items.CollectionChanged -= ItemsChanged;
        refreshTimer.Stop();
        stateTimer?.Stop();
        acceptTimer?.Stop();
        editTimer?.Stop();
        categoryDropTimer?.Stop();
        ReleaseView();
        DestroyWindow(handle.Handle);
        container = IntPtr.Zero;
    }

    private void ReleaseView()
    {
        InterfaceTheme.Changed -= ApplyPalette;
        RemoveDropTarget();
        if (view is not null)
        {
            if (viewWindow != IntPtr.Zero)
            {
                SaveIconState();
                view.UIActivate(0);
                view.DestroyViewWindow();
            }
            Marshal.ReleaseComObject(view); view = null;
        }
        viewWindow = IntPtr.Zero;
        if (folder is not null) { Marshal.ReleaseComObject(folder); folder = null; }
        if (folderPidl != IntPtr.Zero) { Marshal.FreeCoTaskMem(folderPidl); folderPidl = IntPtr.Zero; }
        browser = null;
    }

    private void ApplyPalette()
    {
        IntPtr list = FindDescendant(viewWindow, "SysListView32");
        if (list == IntPtr.Zero) return;
        SendMessage(list, 0x1001, IntPtr.Zero, InterfaceTheme.NativeColor("Surface"));
        SendMessage(list, 0x1024, IntPtr.Zero, InterfaceTheme.NativeColor("Text"));
        SendMessage(list, 0x1026, IntPtr.Zero, new IntPtr(-1));
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class Browser : IShellBrowser, ICommDlgBrowser, ICommDlgBrowser2, ShellViewInterop.IServiceProvider, INewMenuClient
    {
        private readonly DesktopShellView owner;
        internal Browser(DesktopShellView owner) => this.owner = owner;
        public int GetWindow(out IntPtr window) { window = owner.container; return 0; }
        public int ContextSensitiveHelp(bool enter) => unchecked((int)0x80004001);
        public int InsertMenusSB(IntPtr menu, IntPtr widths) => 0;
        public int SetMenuSB(IntPtr menu, IntPtr shared, IntPtr active) => 0;
        public int RemoveMenusSB(IntPtr menu) => 0;
        public int SetStatusTextSB(string? text) => 0;
        public int EnableModelessSB(bool enable) { owner.modelessDisabled = !enable; return 0; }
        public int TranslateAcceleratorSB(ref MSG message, ushort id) => 1;
        public int BrowseObject(IntPtr pidl, uint flags)
        {
            try
            {
                if (PathFor((flags & 0x1000) != 0 ? owner.folderPidl : IntPtr.Zero, pidl) is not { } path) return unchecked((int)0x80004001);
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); return 0;
            }
            catch (Exception exception) { return Marshal.GetHRForException(exception); }
        }
        public int GetViewStateStream(uint mode, out IntPtr stream) { stream = IntPtr.Zero; return unchecked((int)0x80004001); }
        public int GetControlWindow(uint id, out IntPtr window) { window = IntPtr.Zero; return unchecked((int)0x80004001); }
        public int SendControlMsg(uint id, uint message, IntPtr wparam, IntPtr lparam, out IntPtr result) { result = IntPtr.Zero; return unchecked((int)0x80004001); }
        public int QueryActiveShellView(out IntPtr view) { view = owner.view is null ? IntPtr.Zero : Marshal.GetComInterfaceForObject(owner.view, typeof(IShellView)); return 0; }
        public int OnViewWindowActive(IntPtr view) => 0;
        public int SetToolbarItems(IntPtr buttons, uint count, uint flags) => unchecked((int)0x80004001);
        public int OnDefaultCommand(IntPtr view) => 1;
        public int OnStateChange(IntPtr view, uint change) { owner.QueueAcceptedSelection(); return 0; }
        public int IncludeObject(IntPtr view, IntPtr pidl)
        {
            owner.FilterCalls++;
            try
            {
                if (PathFor(owner.folderPidl, pidl) is not { } path) return 1;
                if (owner.included.Contains(path)) return 0;
                bool receiver = owner.receivingNativeDrop || IsChild(owner.viewWindow, GetFocus());
                return receiver && !activeViews.Any(candidate => candidate.included.Contains(path)) ? 0 : 1;
            }
            catch (COMException) { return 1; }
        }
        public int Notify(IntPtr view, uint kind) => 0;
        public int GetDefaultMenuText(IntPtr view, IntPtr text, int count) => 1;
        public int GetViewFlags(out uint flags) { flags = 8; return 0; }
        public int QueryService(ref Guid service, ref Guid id, out IntPtr result)
        {
            result = IntPtr.Zero;
            if (service == typeof(INewMenuClient).GUID && id == typeof(INewMenuClient).GUID)
            { result = Marshal.GetComInterfaceForObject(this, typeof(INewMenuClient)); return 0; }
            if (owner.view is null || service != typeof(IFolderView).GUID && service != typeof(INewMenuClient).GUID) return unchecked((int)0x80004002);
            IntPtr unknown = Marshal.GetIUnknownForObject(owner.view);
            try { return Marshal.QueryInterface(unknown, in id, out result); }
            finally { Marshal.Release(unknown); }
        }
        public int IncludeItems(out uint flags) { flags = 3; return 0; }
        public int SelectAndEditItem(IntPtr absolutePidl, uint flags)
        {
            try { owner.EditNewShellItem(absolutePidl, flags); return 0; }
            catch (Exception exception) { return Marshal.GetHRForException(exception); }
        }
    }
}
