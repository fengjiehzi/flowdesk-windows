using System.Runtime.InteropServices;
using IDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;
using System.Windows;
using System.Windows.Threading;
using static SmartDeskBox.DesktopApp.ShellViewInterop;

namespace SmartDeskBox.DesktopApp;

public partial class DesktopBoxWindow
{
    private readonly DispatcherTimer capsuleTimer = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private bool temporaryExpansion, changingTemporarily, categoryMenuOpen;
    private System.Windows.Rect? capsuleAnchor;
    private HeaderDrop? headerDrop;
    public bool PersistCollapsed => temporaryExpansion || Box.IsCollapsed;
    public System.Windows.Rect LayoutBounds => temporaryExpansion && capsuleAnchor is { } anchor
        ? anchor : DesktopNative.Bounds(Handle);
    public bool HasActiveInteraction => geometry is not null || headerDrop?.IsDragging == true || ShellView.HasActiveNativeOperation;
    internal IDropTarget HeaderDropTarget => headerDrop ?? throw new InvalidOperationException("区块拖放尚未就绪。");

    private void InitializeCapsule()
    {
        capsuleTimer.Tick += (_, _) =>
        {
            if (!temporaryExpansion || IsClosed) { capsuleTimer.Stop(); return; }
            var pointer = System.Windows.Forms.Cursor.Position;
            if (DesktopNative.Bounds(Handle).Contains(pointer.X, pointer.Y) || HasActiveInteraction ||
                ShellView.IsEditing || ShellView.HasPendingImports || categoryMenuOpen || NativeMenuOpen()) return;
            RestoreCapsule();
        };
        MouseEnter += (_, _) => { if (settings.HoverExpand) ExpandTemporarily(); };
        Closed += (_, _) => { capsuleTimer.Stop(); if (headerDrop is not null) { headerDrop.DragLeave(); RevokeDragDrop(Handle); } };
    }

    private void ExpandTemporarily()
    {
        if (!Box.IsCollapsed || Handle == IntPtr.Zero) return;
        capsuleAnchor = DesktopNative.Bounds(Handle);
        temporaryExpansion = changingTemporarily = true;
        try { Box.IsCollapsed = false; }
        finally { changingTemporarily = false; }
        var bounds = DesktopNative.Bounds(Handle);
        var area = DesktopLayout.WorkAreaFor(capsuleAnchor.Value);
        bounds.Y = Math.Clamp(bounds.Y, area.Top, Math.Max(area.Top, area.Bottom - bounds.Height));
        DesktopNative.Place(Handle, host, bounds);
        capsuleTimer.Start();
    }

    private void RestoreCapsule()
    {
        temporaryExpansion = false;
        changingTemporarily = true;
        try
        {
            Box.IsCollapsed = true;
            if (capsuleAnchor is { } anchor) DesktopNative.Place(Handle, host, anchor);
        }
        finally { changingTemporarily = false; capsuleAnchor = null; capsuleTimer.Stop(); }
    }

    private void RegisterHeaderDrop()
    {
        headerDrop = new(this);
        int result = RevokeDragDrop(Handle);
        if (result < 0 && result != unchecked((int)0x80040100)) Marshal.ThrowExceptionForHR(result);
        Marshal.ThrowExceptionForHR(RegisterDragDrop(Handle, headerDrop));
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo
    {
        public int Size; public uint Flags;
        public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public ShellViewInterop.Rect CaretBounds;
    }
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    private static bool NativeMenuOpen()
    {
        var info = new GuiThreadInfo { Size = Marshal.SizeOf<GuiThreadInfo>() };
        return GetGUIThreadInfo(0, ref info) && (info.Flags & (4 | 16)) != 0;
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    private sealed class HeaderDrop(DesktopBoxWindow owner) : IDropTarget
    {
        private IDataObject? data;
        private IDropTarget? target;
        private uint allowed;
        internal bool IsDragging => data is not null;

        public int DragEnter(IDataObject value, uint keys, long point, ref uint effect)
        {
            DragLeave(); data = value; allowed = effect;
            try { if (owner.settings.DragExpand) owner.ExpandTemporarily(); return Forward(keys, point, ref effect); }
            catch (Exception exception) { DragLeave(); effect = 0; owner.ShowFileFeedback(exception.Message); return Marshal.GetHRForException(exception); }
        }

        private int Forward(uint keys, long point, ref uint effect)
        {
            effect = allowed;
            if (data is null || owner.Box.IsCollapsed || owner.ShellView.DropTargetHandle == IntPtr.Zero) { effect = 0; return 0; }
            if (target is not null) return target.DragOver(keys, point, ref effect);
            target = owner.ShellView.NativeDropTarget;
            return target.DragEnter(data, keys, point, ref effect);
        }

        public int DragOver(uint keys, long point, ref uint effect)
        {
            try { return Forward(keys, point, ref effect); }
            catch (Exception exception) { DragLeave(); effect = 0; return Marshal.GetHRForException(exception); }
        }
        public int DragLeave()
        {
            try { return target?.DragLeave() ?? 0; }
            finally { data = null; target = null; allowed = 0; }
        }
        public int Drop(IDataObject value, uint keys, long point, ref uint effect)
        {
            try
            {
                int result = Forward(keys, point, ref effect);
                return result < 0 || effect == 0 || target is null ? result : target.Drop(value, keys, point, ref effect);
            }
            catch (Exception exception) { effect = 0; owner.ShowFileFeedback(exception.Message); return Marshal.GetHRForException(exception); }
            finally { DragLeave(); }
        }
    }
}
