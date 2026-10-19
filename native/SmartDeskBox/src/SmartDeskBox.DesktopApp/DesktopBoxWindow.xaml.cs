using System.ComponentModel;
using System.Windows;
using System.Windows.Controls.Primitives;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Media;
using SmartDeskBox.Core;

namespace SmartDeskBox.DesktopApp;

public partial class DesktopBoxWindow : Window
{
    private readonly Func<ItemViewModel, AppCategory, Task> reclassify;
    private readonly Action<DesktopBoxWindow> save;
    private readonly Action<FrameworkElement> showMenu;
    private IntPtr host;
    private double expandedHeight;
    private DesktopSnapSession? geometry;
    private System.Drawing.Point? dragPointer;
    private Vector dragDisplacement;
    private bool geometryResize;
    private InterfaceSettings settings = new();
    public Func<IReadOnlyList<Rect>>? SnapNeighbors { get; set; }
    public CategoryBox Box { get; }
    public DesktopShellView ShellView { get; }
    public IntPtr Handle { get; private set; }
    public bool IsClosed { get; private set; }
    public double ExpandedHeight => expandedHeight;
    public bool IsDesktopAttached => DesktopNative.IsAttached(Handle, host);

    public DesktopBoxWindow(CategoryBox box, Func<ItemViewModel, AppCategory, Task> reclassify,
        Action<DesktopBoxWindow> save, Action<FrameworkElement> showMenu, string? sourceFolder = null, string? statePath = null)
    {
        Box = box;
        this.reclassify = reclassify;
        this.save = save;
        this.showMenu = showMenu;
        InitializeComponent();
        DataContext = box;
        ShellView = new DesktopShellView(box, sourceFolder, statePath) { Feedback = ShowFileFeedback };
        ShellView.ReclassifyDropped = async paths =>
        {
            var selected = DesktopShellView.FindItems(paths);
            foreach (var item in selected) await reclassify(item, Box.Info.Category);
        };
        ShellContainer.Child = ShellView;
        InitializeCapsule();
        Title = "流屿桌面 · " + box.Info.Name;
        Box.PropertyChanged += Box_PropertyChanged;
        Closed += (_, _) => { IsClosed = true; Box.PropertyChanged -= Box_PropertyChanged; ShellView.Dispose(); };
    }

    public void Attach(IntPtr desktopHost, Rect bounds)
    {
        host = desktopHost;
        expandedHeight = bounds.Height;
        Width = bounds.Width;
        Height = Box.IsCollapsed ? 48 : bounds.Height;
        Left = bounds.Left;
        Top = bounds.Top;
        new WindowInteropHelper(this).Owner = host;
        Show();
        Handle = DesktopNative.Attach(this, host);
        RegisterHeaderDrop();
        DesktopNative.Place(Handle, host, new(bounds.Location, new Size(bounds.Width, Box.IsCollapsed ? 48 : bounds.Height)));
    }

    public void SetBounds(Rect bounds)
    {
        expandedHeight = Math.Max(80, bounds.Height);
        DesktopNative.Place(Handle, host, new(bounds.Location, new Size(bounds.Width, Box.IsCollapsed ? 48 : expandedHeight)));
    }

    private void Move_DragDelta(object sender, DragDeltaEventArgs e)
    {
        ApplyGeometry(e, false);
    }

    private void Resize_DragDelta(object sender, DragDeltaEventArgs e)
    {
        ApplyGeometry(e, true);
    }

    private void Geometry_DragStarted(object sender, DragStartedEventArgs e)
    {
        geometry = null;
        dragDisplacement = default;
        dragPointer = System.Windows.Forms.Cursor.Position;
    }

    private void ApplyGeometry(DragDeltaEventArgs e, bool resize)
    {
        var dpi = VisualTreeHelper.GetDpi(this);
        if (geometry is not null && geometryResize != resize) { geometry = null; dragDisplacement = default; }
        geometryResize = resize;
        geometry ??= new(DesktopNative.Bounds(Handle), SnapNeighbors?.Invoke() ?? [], dpi.DpiScaleX, dpi.DpiScaleY);
        if (dragPointer is { } start)
        {
            var current = System.Windows.Forms.Cursor.Position;
            dragDisplacement = new(current.X - start.X, current.Y - start.Y);
        }
        else dragDisplacement += new Vector(e.HorizontalChange * dpi.DpiScaleX, e.VerticalChange * dpi.DpiScaleY);
        var proposed = geometry.Origin;
        if (!resize) proposed.Offset(dragDisplacement);
        var bounds = geometry.Resolve(dragDisplacement, DesktopLayout.WorkAreaFor(proposed), resize, !settings.SnapEnabled || Keyboard.Modifiers.HasFlag(ModifierKeys.Alt));
        if (resize) SetBounds(bounds);
        else DesktopNative.Place(Handle, host, bounds);
        if (geometry.IsSnapped) BoxBorder.BorderBrush = SystemColors.HighlightBrush;
        else BoxBorder.SetResourceReference(System.Windows.Controls.Border.BorderBrushProperty, "Stroke");
    }

    private void Geometry_DragCompleted(object sender, DragCompletedEventArgs e)
    {
        if (e.Canceled && geometry is not null)
        {
            if (Box.IsCollapsed) DesktopNative.Place(Handle, host, geometry.Origin);
            else SetBounds(geometry.Origin);
        }
        else
        {
            if (temporaryExpansion)
            {
                var bounds = DesktopNative.Bounds(Handle);
                capsuleAnchor = new(bounds.Location, new Size(bounds.Width, 48));
            }
            save(this);
        }
        geometry = null;
        dragPointer = null;
        dragDisplacement = default;
        BoxBorder.SetResourceReference(System.Windows.Controls.Border.BorderBrushProperty, "Stroke");
    }

    public void ApplySettings(InterfaceSettings value)
    {
        settings = value;
        MoveThumb.IsEnabled = ResizeThumb.IsEnabled = !value.LockLayout;
        if (!value.HoverExpand && temporaryExpansion && !HasActiveInteraction) RestoreCapsule();
    }
    private void Collapse_Click(object sender, RoutedEventArgs e)
    {
        if (temporaryExpansion) { RestoreCapsule(); save(this); return; }
        temporaryExpansion = false;
        capsuleTimer.Stop();
        Box.IsCollapsed = !Box.IsCollapsed;
    }
    private void Menu_Click(object sender, RoutedEventArgs e) => showMenu((FrameworkElement)sender);

    private void Box_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(CategoryBox.IsCollapsed) || Handle == IntPtr.Zero || !IsDesktopAttached) return;
        var bounds = DesktopNative.Bounds(Handle);
        bounds.Height = Box.IsCollapsed ? 48 : expandedHeight;
        DesktopNative.Place(Handle, host, bounds);
        if (!changingTemporarily) save(this);
    }

}
