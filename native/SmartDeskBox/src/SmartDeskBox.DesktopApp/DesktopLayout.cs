using System.Runtime.InteropServices;
using System.Windows;
using SmartDeskBox.Core;
using Forms = System.Windows.Forms;

namespace SmartDeskBox.DesktopApp;

public static class DesktopLayout
{
    public static Rect WorkAreaFor(Rect bounds)
    {
        var screen = Forms.Screen.FromRectangle(new((int)bounds.X, (int)bounds.Y, (int)bounds.Width, (int)bounds.Height));
        var area = screen.WorkingArea;
        return new(area.X, area.Y, area.Width, area.Height);
    }

    public static Rect WorkAreaForPoint(System.Drawing.Point point)
    {
        var screen = Forms.Screen.FromPoint(point);
        var area = screen.WorkingArea;
        return new(area.X, area.Y, area.Width, area.Height);
    }

    public static double DpiScaleFor(Forms.Screen screen)
    {
        try
        {
            var pt = new NativePoint { X = screen.Bounds.Left + screen.Bounds.Width / 2, Y = screen.Bounds.Top + screen.Bounds.Height / 2 };
            var monitor = MonitorFromPoint(pt, 2);
            if (monitor != IntPtr.Zero && GetDpiForMonitor(monitor, 0, out var dpiX, out _) == 0 && dpiX > 0)
                return dpiX / 96.0;
        }
        catch { }
        return 1.0;
    }

    public static Dictionary<AppCategory, Rect> Plan(IReadOnlyList<CategoryBox> boxes)
    {
        var screen = Forms.Screen.PrimaryScreen ?? Forms.Screen.AllScreens[0];
        var area = screen.WorkingArea;
        var scale = DpiScaleFor(screen);
        double margin = 20 * scale, gap = 14 * scale, gutter = 28 * scale;
        double minHeader = 66 * scale, minHeight = 80 * scale;
        var fileWidth = Math.Clamp(area.Width * .23, 280 * scale, 400 * scale);
        var appWidth = area.Width - 2 * margin - fileWidth - gutter;
        var columns = Math.Clamp((int)(appWidth / (320 * scale)), 1, 3);
        var width = (appWidth - (columns - 1) * gap) / columns;
        var result = new Dictionary<AppCategory, Rect>();
        var groups = Enumerable.Range(0, columns).Select(_ => new List<(CategoryBox Box, double Height)>()).ToList();
        foreach (var box in boxes.Where(b => !b.Info.IsFile))
        {
            var column = groups.OrderBy(g => g.Sum(x => x.Height + gap)).First();
            var iconColumns = Math.Max(1, (int)((width - 28 * scale) / (104 * scale)));
            var rows = Math.Max(1, (int)Math.Ceiling(box.Items.Count / (double)iconColumns));
            column.Add((box, Math.Min(402 * scale, minHeader + rows * 84 * scale)));
        }
        for (var i = 0; i < columns; i++)
            PlaceColumn(groups[i], area.Left + margin + i * (width + gap), width);
        PlaceColumn(boxes.Where(b => b.Info.IsFile).Select(b => (b, Math.Max(112.0 * scale, minHeader + b.Items.Count * 32 * scale))).ToList(),
            area.Right - margin - fileWidth, fileWidth);
        return result;

        void PlaceColumn(List<(CategoryBox Box, double Height)> column, double x, double columnWidth)
        {
            var available = area.Height - 2 * margin - Math.Max(0, column.Count - 1) * gap;
            var desired = column.Sum(b => b.Height - minHeader);
            var ratio = desired == 0 ? 1 : Math.Min(1, (available - column.Count * minHeader) / desired);
            var y = area.Top + margin;
            foreach (var (box, height) in column)
            {
                var actual = Math.Max(minHeight, minHeader + (height - minHeader) * ratio);
                result[box.Info.Category] = new(x, y, columnWidth, actual);
                y += actual + gap;
            }
        }
    }

    public static Rect Restore(BoxLayoutState? state, int index)
    {
        var defaults = Categories.All.Select(c => new CategoryBox(c, false)).ToList();
        return Restore(state, Plan(defaults)[defaults[index].Info.Category]);
    }

    public static Rect Restore(BoxLayoutState? state, Rect fallback)
    {
        var screen = Forms.Screen.AllScreens.FirstOrDefault(s => "desktop-grouped:" + s.DeviceName == state?.MonitorId)
            ?? Forms.Screen.PrimaryScreen ?? Forms.Screen.AllScreens[0];
        var area = screen.WorkingArea;
        var scale = DpiScaleFor(screen);
        var bounds = fallback;
        if (state?.MonitorId.StartsWith("desktop-grouped:", StringComparison.Ordinal) == true &&
            new[] { state.XRatio, state.YRatio, state.WidthRatio, state.HeightRatio }.All(double.IsFinite))
            bounds = new(area.Left + state.XRatio * area.Width, area.Top + state.YRatio * area.Height,
                Math.Clamp(state.WidthRatio * area.Width, 220 * scale, Math.Max(220 * scale, area.Width)),
                Math.Clamp(state.HeightRatio * area.Height, 80 * scale, Math.Max(80 * scale, area.Height)));
        bounds.X = Math.Clamp(bounds.X, area.Left, Math.Max(area.Left, area.Right - bounds.Width));
        bounds.Y = Math.Clamp(bounds.Y, area.Top, Math.Max(area.Top, area.Bottom - bounds.Height));
        return bounds;
    }

    public static BoxLayoutState Capture(DesktopBoxWindow window)
    {
        var bounds = window.LayoutBounds;
        var screen = Forms.Screen.FromHandle(window.Handle);
        var area = screen.WorkingArea;
        return new(window.Box.Info.Category, "desktop-grouped:" + screen.DeviceName, (bounds.X - area.Left) / area.Width,
            (bounds.Y - area.Top) / area.Height, bounds.Width / area.Width, window.ExpandedHeight / area.Height, window.PersistCollapsed);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X, Y; }
    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);
    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr monitor, int dpiType, out uint dpiX, out uint dpiY);
}
