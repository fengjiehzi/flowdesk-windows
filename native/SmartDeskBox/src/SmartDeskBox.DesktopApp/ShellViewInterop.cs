using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Runtime.CompilerServices;
using System.Windows.Interop;

[assembly: InternalsVisibleTo("SmartDeskBox.Tests")]

namespace SmartDeskBox.DesktopApp;

public static class ShellViewInterop
{
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct FolderSettings { public uint Mode, Flags; }

    [ComImport, Guid("000214E6-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellFolder
    {
        void ParseDisplayName(IntPtr owner, IntPtr context, [MarshalAs(UnmanagedType.LPWStr)] string name, ref uint eaten, out IntPtr pidl, ref uint attributes);
        void EnumObjects(IntPtr owner, uint flags, out IntPtr enumerator);
        void BindToObject(IntPtr pidl, IntPtr context, ref Guid id, [MarshalAs(UnmanagedType.Interface)] out IShellFolder folder);
        void BindToStorage(IntPtr pidl, IntPtr context, ref Guid id, out IntPtr storage);
        [PreserveSig] int CompareIDs(IntPtr flags, IntPtr first, IntPtr second);
        void CreateViewObject(IntPtr owner, ref Guid id, [MarshalAs(UnmanagedType.IUnknown)] out object view);
        void GetAttributesOf(uint count, IntPtr items, ref uint attributes);
        void GetUIObjectOf(IntPtr owner, uint count, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] IntPtr[] items, ref Guid id, IntPtr reserved, [MarshalAs(UnmanagedType.IUnknown)] out object result);
        void GetDisplayNameOf(IntPtr pidl, uint flags, IntPtr result);
        void SetNameOf(IntPtr owner, IntPtr pidl, [MarshalAs(UnmanagedType.LPWStr)] string name, uint flags, out IntPtr renamed);
    }

    [ComImport, Guid("000214E3-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellView
    {
        void GetWindow(out IntPtr window);
        void ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enter);
        [PreserveSig] int TranslateAccelerator(ref MSG message);
        void EnableModeless([MarshalAs(UnmanagedType.Bool)] bool enable);
        void UIActivate(uint state);
        void Refresh();
        void CreateViewWindow(IShellView? previous, ref FolderSettings settings, IShellBrowser browser, ref Rect bounds, out IntPtr window);
        void DestroyViewWindow();
        void GetCurrentInfo(out FolderSettings settings);
        void AddPropertySheetPages(uint reserved, IntPtr callback, IntPtr parameter);
        void SaveViewState();
        void SelectItem(IntPtr pidl, uint flags);
        void GetItemObject(uint item, ref Guid id, [MarshalAs(UnmanagedType.IUnknown)] out object result);
    }

    [ComVisible(true), Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellBrowser
    {
        [PreserveSig] int GetWindow(out IntPtr window);
        [PreserveSig] int ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)] bool enter);
        [PreserveSig] int InsertMenusSB(IntPtr menu, IntPtr widths);
        [PreserveSig] int SetMenuSB(IntPtr menu, IntPtr shared, IntPtr active);
        [PreserveSig] int RemoveMenusSB(IntPtr menu);
        [PreserveSig] int SetStatusTextSB([MarshalAs(UnmanagedType.LPWStr)] string? text);
        [PreserveSig] int EnableModelessSB([MarshalAs(UnmanagedType.Bool)] bool enable);
        [PreserveSig] int TranslateAcceleratorSB(ref MSG message, ushort id);
        [PreserveSig] int BrowseObject(IntPtr pidl, uint flags);
        [PreserveSig] int GetViewStateStream(uint mode, out IntPtr stream);
        [PreserveSig] int GetControlWindow(uint id, out IntPtr window);
        [PreserveSig] int SendControlMsg(uint id, uint message, IntPtr wparam, IntPtr lparam, out IntPtr result);
        [PreserveSig] int QueryActiveShellView(out IntPtr view);
        [PreserveSig] int OnViewWindowActive(IntPtr view);
        [PreserveSig] int SetToolbarItems(IntPtr buttons, uint count, uint flags);
    }

    [ComVisible(true), Guid("000214F1-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ICommDlgBrowser
    {
        [PreserveSig] int OnDefaultCommand(IntPtr view);
        [PreserveSig] int OnStateChange(IntPtr view, uint change);
        [PreserveSig] int IncludeObject(IntPtr view, IntPtr pidl);
    }

    [ComVisible(true), Guid("10339516-2894-11D2-9039-00C04F8EEB3E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ICommDlgBrowser2
    {
        [PreserveSig] int OnDefaultCommand(IntPtr view);
        [PreserveSig] int OnStateChange(IntPtr view, uint change);
        [PreserveSig] int IncludeObject(IntPtr view, IntPtr pidl);
        [PreserveSig] int Notify(IntPtr view, uint kind);
        [PreserveSig] int GetDefaultMenuText(IntPtr view, IntPtr text, int count);
        [PreserveSig] int GetViewFlags(out uint flags);
    }

    [ComVisible(true), Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IServiceProvider
    {
        [PreserveSig] int QueryService(ref Guid service, ref Guid id, out IntPtr result);
    }

    [ComVisible(true), Guid("DCB07FDC-3BB5-451C-90BE-966644FED7B0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface INewMenuClient
    {
        [PreserveSig] int IncludeItems(out uint flags);
        [PreserveSig] int SelectAndEditItem(IntPtr absolutePidl, uint flags);
    }

    [ComImport, Guid("FC4801A3-2BA9-11CF-A229-00AA003D7352"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IObjectWithSite
    {
        void SetSite([MarshalAs(UnmanagedType.IUnknown)] object? site);
        void GetSite(ref Guid id, out IntPtr site);
    }

    [ComVisible(true), Guid("00000122-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDropTarget
    {
        [PreserveSig] int DragEnter(IDataObject data, uint keys, long point, ref uint effect);
        [PreserveSig] int DragOver(uint keys, long point, ref uint effect);
        [PreserveSig] int DragLeave();
        [PreserveSig] int Drop(IDataObject data, uint keys, long point, ref uint effect);
    }

    [ComImport, Guid("000214F2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IEnumIDList
    {
        [PreserveSig] int Next(uint count, out IntPtr pidl, out uint fetched);
        void Skip(uint count);
        void Reset();
        void Clone(out IEnumIDList clone);
    }

    [ComImport, Guid("000214E4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IContextMenu
    {
        [PreserveSig] int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
        void InvokeCommand(IntPtr information);
        [PreserveSig] int GetCommandString(UIntPtr command, uint flags, IntPtr reserved, IntPtr text, uint count);
    }

    [ComImport, Guid("CDE725B0-CCC9-4519-917E-325D72FAB4CE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFolderView
    {
        void GetCurrentViewMode(out uint mode);
        void SetCurrentViewMode(uint mode);
        void GetFolder(ref Guid id, out IntPtr folder);
        void Item(int index, out IntPtr pidl);
        void ItemCount(uint flags, out int count);
        void Items(uint flags, ref Guid id, out IntPtr items);
        void GetSelectionMarkedItem(out int index);
        void GetFocusedItem(out int index);
        void GetItemPosition(IntPtr pidl, out Point position);
        void GetSpacing(out Point spacing);
        void GetDefaultSpacing(out Point spacing);
        [PreserveSig] int GetAutoArrange();
        void SelectItem(int index, uint flags);
        void SelectAndPositionItems(uint count, IntPtr items, IntPtr points, uint flags);
    }

    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
    [DllImport("shell32.dll")] internal static extern int SHGetDesktopFolder(out IShellFolder folder);
    [DllImport("shell32.dll")] internal static extern int SHGetSpecialFolderLocation(IntPtr owner, int folder, out IntPtr pidl);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] internal static extern int SHParseDisplayName(string name, IntPtr context, out IntPtr pidl, uint mask, out uint attributes);
    [DllImport("shell32.dll")] internal static extern IntPtr ILCombine(IntPtr parent, IntPtr child);
    [DllImport("shell32.dll")] internal static extern int SHGetNameFromIDList(IntPtr pidl, uint kind, out IntPtr name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr CreateWindowEx(uint exStyle, string className, string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] internal static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] internal static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] internal static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] internal static extern IntPtr GetFocus();
    [DllImport("user32.dll")] internal static extern IntPtr GetCapture();
    [DllImport("user32.dll")] internal static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string? className, string? name);
    [DllImport("user32.dll")] internal static extern bool GetClientRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")] internal static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] internal static extern bool ScreenToClient(IntPtr window, ref Point point);
    [DllImport("user32.dll")] internal static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] internal static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] internal static extern IntPtr SendText(IntPtr window, uint message, IntPtr wparam, string text);
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    internal delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] internal static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    [DllImport("ole32.dll")] internal static extern int RegisterDragDrop(IntPtr window, IDropTarget target);
    [DllImport("ole32.dll")] internal static extern int RevokeDragDrop(IntPtr window);
    [DllImport("ole32.dll")] internal static extern void ReleaseStgMedium(ref STGMEDIUM medium);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] internal static extern uint DragQueryFile(IntPtr drop, uint index, StringBuilder? name, uint count);
    [DllImport("user32.dll")] internal static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll")] internal static extern bool DestroyMenu(IntPtr menu);

    internal static IntPtr FindDescendant(IntPtr parent, string className)
    {
        if (parent == IntPtr.Zero) return IntPtr.Zero;
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (window, _) =>
        {
            var name = new StringBuilder(128);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != className) return true;
            found = window; return false;
        }, IntPtr.Zero);
        return found;
    }

    internal static string[] FileDropPaths(IDataObject data)
    {
        var format = new FORMATETC { cfFormat = 15, dwAspect = DVASPECT.DVASPECT_CONTENT, lindex = -1, tymed = TYMED.TYMED_HGLOBAL };
        if (data.QueryGetData(ref format) < 0) return [];
        data.GetData(ref format, out var medium);
        try
        {
            uint count = DragQueryFile(medium.unionmember, uint.MaxValue, null, 0);
            var paths = new List<string>();
            for (uint index = 0; index < count; index++)
            {
                var path = new StringBuilder((int)DragQueryFile(medium.unionmember, index, null, 0) + 1);
                DragQueryFile(medium.unionmember, index, path, (uint)path.Capacity); paths.Add(path.ToString());
            }
            return paths.ToArray();
        }
        finally { ReleaseStgMedium(ref medium); }
    }

    internal static string? PathFor(IntPtr parent, IntPtr child)
    {
        IntPtr absolute = ILCombine(parent, child);
        try
        {
            if (SHGetNameFromIDList(absolute, 0x80058000, out IntPtr text) < 0) return null;
            try { return Marshal.PtrToStringUni(text); }
            finally { Marshal.FreeCoTaskMem(text); }
        }
        finally { Marshal.FreeCoTaskMem(absolute); }
    }
}
