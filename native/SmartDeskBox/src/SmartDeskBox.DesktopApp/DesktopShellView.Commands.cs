using System.Runtime.InteropServices;
using System.Windows.Threading;
using static SmartDeskBox.DesktopApp.ShellViewInterop;

namespace SmartDeskBox.DesktopApp;

public sealed partial class DesktopShellView
{
    private DispatcherTimer? editTimer;
    [StructLayout(LayoutKind.Sequential)] private struct InvokeInfo
    {
        public int Size; public uint Mask; public IntPtr Owner, Verb, Parameters, Directory;
        public int Show; public uint HotKey; public IntPtr Icon;
    }

    internal void InvokeNativeCommand(string verb, bool background)
    {
        Guid id = typeof(IContextMenu).GUID;
        NativeView.GetItemObject(background ? 0u : 1u, ref id, out var context);
        IntPtr menu = CreatePopupMenu(), name = Marshal.StringToHGlobalAnsi(verb), memory = Marshal.AllocHGlobal(Marshal.SizeOf<InvokeInfo>());
        try
        {
            if (context is IObjectWithSite site) site.SetSite(browser);
            Marshal.ThrowExceptionForHR(((IContextMenu)context).QueryContextMenu(menu, 0, 1, 0x7fff, 0x10));
            var command = new InvokeInfo { Size = Marshal.SizeOf<InvokeInfo>(), Owner = container, Verb = name, Show = 1 };
            Marshal.StructureToPtr(command, memory, false);
            ((IContextMenu)context).InvokeCommand(memory);
        }
        finally { DestroyMenu(menu); Marshal.FreeHGlobal(name); Marshal.FreeHGlobal(memory); Marshal.ReleaseComObject(context); }
    }

    private void EditNewShellItem(IntPtr absolutePidl, uint flags)
    {
        string? path = PathFor(IntPtr.Zero, absolutePidl);
        if (path is null) return;
        if (!Dispatcher.CheckAccess()) { Dispatcher.BeginInvoke(() => EditNewShellPath(path, flags)); return; }
        EditNewShellPath(path, flags);
    }

    private void EditNewShellPath(string path, uint flags)
    {
        if (viewWindow == IntPtr.Zero) return;
        receivingNativeDrop = true;
        view?.Refresh();
        editTimer?.Stop();
        int attempts = 0;
        editTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
        editTimer.Tick += (_, _) =>
        {
            if (view is null || ++attempts > 100) { editTimer.Stop(); return; }
            int index = VisiblePaths().ToList().FindIndex(candidate => candidate.Equals(path, StringComparison.OrdinalIgnoreCase));
            if (index < 0) return;
            editTimer.Stop();
            try
            {
                ((IFolderView)view).Item(index, out IntPtr pidl);
                try { view.UIActivate(2); view.SelectItem(pidl, 1u | 4 | 8 | 16 | ((flags & 1) != 0 ? 2u : 0)); }
                finally { Marshal.FreeCoTaskMem(pidl); }
            }
            catch (COMException exception) { Feedback?.Invoke("新项目原位编辑失败：" + exception.Message); }
        };
        editTimer.Start();
    }
}
