using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Windows.Threading;
using static SmartDeskBox.DesktopApp.ShellViewInterop;

namespace SmartDeskBox.DesktopApp;

public sealed partial class DesktopShellView
{
    private static DesktopShellView[] activeViews = [];
    private DropTarget? dropTarget;
    private IntPtr dropWindow;
    private bool receivingNativeDrop, nativeDropRunning;
    private DispatcherTimer? categoryDropTimer;
    public Func<IReadOnlyList<string>, Task>? ReclassifyDropped { get; set; }
    public Action<string>? Feedback { get; set; }
    public IntPtr DropTargetHandle => dropWindow;
    internal IDropTarget NativeDropTarget => dropTarget ?? throw new InvalidOperationException("Windows 拖放尚未就绪。");

    internal static ItemViewModel[] FindItems(IReadOnlyList<string> paths) => paths.Select(path =>
        activeViews.SelectMany(candidate => candidate.box.Items).FirstOrDefault(item =>
            item.Item.Metadata.SourceFilePath.Equals(path, StringComparison.OrdinalIgnoreCase))).OfType<ItemViewModel>().ToArray();

    private void InstallDropTarget()
    {
        Guid id = typeof(IDropTarget).GUID;
        object original;
        if (view is IDropTarget nativeTarget) original = nativeTarget;
        else folder!.CreateViewObject(container, ref id, out original);
        folder!.CreateViewObject(container, ref id, out var background);
        if (background is IObjectWithSite site) site.SetSite(view);
        dropTarget = new(this, (IDropTarget)original, (IDropTarget)background);
        dropWindow = FindDescendant(viewWindow, "SysListView32");
        if (dropWindow == IntPtr.Zero) dropWindow = viewWindow;
        int revoked = RevokeDragDrop(dropWindow);
        if (revoked < 0 && revoked != unchecked((int)0x80040100)) Marshal.ThrowExceptionForHR(revoked);
        Marshal.ThrowExceptionForHR(RegisterDragDrop(dropWindow, dropTarget));
        activeViews = activeViews.Append(this).ToArray();
    }

    private void RemoveDropTarget()
    {
        activeViews = activeViews.Where(candidate => candidate != this).ToArray();
        if (dropWindow != IntPtr.Zero) RevokeDragDrop(dropWindow);
        dropWindow = IntPtr.Zero;
        if (dropTarget is not null)
        {
            dropTarget.DragLeave();
            if (!ReferenceEquals(dropTarget.Original, view)) Marshal.ReleaseComObject(dropTarget.Original);
            if (dropTarget.Background is IObjectWithSite site) site.SetSite(null);
            Marshal.ReleaseComObject(dropTarget.Background);
            dropTarget = null;
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct HitTest { public Point Point; public uint Flags; public int Item, SubItem, Group; }

    private IDropTarget? IconDropTarget(long point, out int index)
    {
        index = -1;
        if (view is not IFolderView items) return null;
        var hit = new HitTest { Point = new() { X = (int)point, Y = (int)(point >> 32) } };
        ScreenToClient(dropWindow, ref hit.Point);
        IntPtr memory = Marshal.AllocHGlobal(Marshal.SizeOf<HitTest>());
        try
        {
            Marshal.StructureToPtr(hit, memory, false);
            index = (int)SendMessage(dropWindow, 0x1012, IntPtr.Zero, memory);
            if (index < 0) return null;
            items.Item(index, out IntPtr pidl);
            try
            {
                Guid id = typeof(IDropTarget).GUID;
                folder!.GetUIObjectOf(container, 1, [pidl], ref id, IntPtr.Zero, out var target);
                return (IDropTarget)target;
            }
            catch (COMException) { return null; }
            catch (InvalidCastException) { return null; }
            finally { Marshal.FreeCoTaskMem(pidl); }
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    private bool IsCategoryDrop(string[] paths, out bool compatible)
    {
        compatible = true;
        if (paths.Length == 0 || ReclassifyDropped is null) return false;
        if (paths.All(included.Contains)) return false;
        var sources = paths.Select(path => activeViews.FirstOrDefault(candidate => candidate.included.Contains(path))).ToArray();
        if (sources.Any(source => source is null)) return false;
        if (sources.Any(source => !string.Equals(source!.folderPath, folderPath, StringComparison.OrdinalIgnoreCase))) return false;
        compatible = sources.All(source => source!.box.IsFile == box.IsFile);
        return true;
    }

    private bool IsExternalDrop(string[] paths) => paths.Length == 0 || paths.Any(path =>
        !activeViews.Any(candidate => candidate.included.Contains(path) && string.Equals(candidate.folderPath, folderPath, StringComparison.OrdinalIgnoreCase)));

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class DropTarget : IDropTarget
    {
        private readonly DesktopShellView owner;
        private string[] paths = [];
        private IDataObject? enteredData;
        private IDropTarget? current;
        private int currentIcon = -1;
        private bool ownsCurrent, targetEntered;
        private uint allowedEffects;
        internal bool IsDragging => enteredData is not null;
        internal IDropTarget Original { get; }
        internal IDropTarget Background { get; }
        internal DropTarget(DesktopShellView owner, IDropTarget original, IDropTarget background) { this.owner = owner; Original = original; Background = background; }

        public int DragEnter(IDataObject data, uint keys, long point, ref uint effect)
        {
            try
            {
                DragLeave();
                paths = FileDropPaths(data);
                enteredData = data;
                allowedEffects = effect;
                owner.receivingNativeDrop = owner.IsExternalDrop(paths);
                return UpdateTarget(keys, point, ref effect);
            }
            catch (Exception exception) { DragLeave(); owner.Feedback?.Invoke(exception.Message); effect = 0; return Marshal.GetHRForException(exception); }
        }

        private int UpdateTarget(uint keys, long point, ref uint effect)
        {
            if (enteredData is null) { effect = 0; return 0; }
            var icon = owner.IconDropTarget(point, out int index);
            bool category = icon is null && owner.IsCategoryDrop(paths, out _);
            IDropTarget? next = icon ?? (category ? null : owner.IsExternalDrop(paths) ? Background : Original);
            bool same = icon is not null ? ownsCurrent && currentIcon == index : !ownsCurrent && ReferenceEquals(current, next);
            if (same && icon is not null) Marshal.ReleaseComObject(icon);
            if (!same)
            {
                LeaveTarget();
                current = next;
                ownsCurrent = icon is not null;
                currentIcon = index;
            }
            effect = allowedEffects;
            if (category)
            {
                owner.IsCategoryDrop(paths, out bool compatible);
                effect = compatible ? allowedEffects & 1u : 0;
                owner.Feedback?.Invoke(!compatible ? "应用与文件分别整理，请拖入同类分区。" : effect == 0
                    ? "来源不允许安全更改分类，本次拖放已拒绝。" : "放下以更改分类；文件位置保持不变。");
                return 0;
            }
            if (current is null) { effect = 0; return 0; }
            int result;
            if (!targetEntered)
            {
                result = current.DragEnter(enteredData, keys, point, ref effect);
                targetEntered = result >= 0;
            }
            else result = current.DragOver(keys, point, ref effect);
            effect &= allowedEffects;
            if (result < 0) effect = 0;
            return result;
        }

        public int DragOver(uint keys, long point, ref uint effect)
        {
            try { return UpdateTarget(keys, point, ref effect); }
            catch (Exception exception) { DragLeave(); effect = 0; return Marshal.GetHRForException(exception); }
        }

        private void LeaveTarget()
        {
            try { if (targetEntered) current?.DragLeave(); }
            finally
            {
                if (ownsCurrent && current is not null) Marshal.ReleaseComObject(current);
                current = null; currentIcon = -1; ownsCurrent = targetEntered = false;
            }
        }

        public int DragLeave()
        {
            try { LeaveTarget(); return 0; }
            catch (Exception exception) { return Marshal.GetHRForException(exception); }
            finally { paths = []; enteredData = null; allowedEffects = 0; owner.receivingNativeDrop = false; }
        }

        public int Drop(IDataObject data, uint keys, long point, ref uint effect)
        {
            try
            {
                int routeResult = UpdateTarget(keys, point, ref effect);
                if (routeResult < 0 || effect == 0) return routeResult;
                if (current is not null)
                {
                    owner.nativeDropRunning = true;
                    try
                    {
                        bool import = ReferenceEquals(current, Background);
                        if (import) { owner.view?.UIActivate(2); SetFocus(FindDescendant(owner.viewWindow, "SysListView32")); }
                        string destination = owner.folderPath ?? Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                        var newTargets = (import ? paths : []).Select(path => Path.Combine(destination, Path.GetFileName(path)))
                            .Where(path => !File.Exists(path) && !Directory.Exists(path)).ToArray();
                        targetEntered = false;
                        int result = current.Drop(data, keys, point, ref effect);
                        // Plain CF_HDROP sources may omit Shell selection callbacks. Never infer an overwritten or conflict-renamed destination.
                        if (result >= 0 && effect != 0)
                        {
                            foreach (string path in newTargets.Where(path => File.Exists(path) || Directory.Exists(path))) owner.verifiedImports.Add(path);
                            owner.QueueAcceptedSelection();
                        }
                        else if (result < 0) { effect = 0; owner.Feedback?.Invoke($"Windows 未完成拖放（0x{result:X8}）。"); }
                        return result;
                    }
                    finally { owner.nativeDropRunning = false; }
                }
                var selected = paths.ToArray();
                var timer = owner.categoryDropTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
                timer.Tick += async (_, _) =>
                {
                    // OLE owns capture until the source drag ends; rebuilding earlier can destroy its view.
                    if (GetCapture() != IntPtr.Zero) return;
                    timer.Stop();
                    try { if (owner.ReclassifyDropped is not null) await owner.ReclassifyDropped(selected); }
                    catch (Exception exception) { owner.Feedback?.Invoke(exception.Message); }
                };
                timer.Start();
                return 0;
            }
            catch (Exception exception) { owner.Feedback?.Invoke(exception.Message); effect = 0; return Marshal.GetHRForException(exception); }
            finally { DragLeave(); }
        }
    }
}
