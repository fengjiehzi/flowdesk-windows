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

    public static Dictionary<AppCategory, Rect> Plan(IReadOnlyList<CategoryBox> boxes)
    {
        var screen = Forms.Screen.PrimaryScreen ?? Forms.Screen.AllScreens[0];
        var area = screen.WorkingArea;
        const double margin = 20, gap = 14, gutter = 28;
        var fileWidth = Math.Clamp(area.Width * .23, 280, 400);
        var appWidth = area.Width - 2 * margin - fileWidth - gutter;
        var columns = Math.Clamp((int)(appWidth / 320), 1, 3);
        var width = (appWidth - (columns - 1) * gap) / columns;
        var result = new Dictionary<AppCategory, Rect>();
        var groups = Enumerable.Range(0, columns).Select(_ => new List<(CategoryBox Box, double Height)>()).ToList();
        foreach (var box in boxes.Where(b => !b.Info.IsFile))
        {
            var column = groups.OrderBy(g => g.Sum(x => x.Height + gap)).First();
            var iconColumns = Math.Max(1, (int)((width - 28) / 104));
            var rows = Math.Max(1, (int)Math.Ceiling(box.Items.Count / (double)iconColumns));
            column.Add((box, Math.Min(402, 66 + rows * 84)));
        }
        for (var i = 0; i < columns; i++)
            PlaceColumn(groups[i], area.Left + margin + i * (width + gap), width);
        PlaceColumn(boxes.Where(b => b.Info.IsFile).Select(b => (b, Math.Max(112.0, 66 + b.Items.Count * 32))).ToList(),
            area.Right - margin - fileWidth, fileWidth);
        return result;

        void PlaceColumn(List<(CategoryBox Box, double Height)> column, double x, double columnWidth)
        {
            var available = area.Height - 2 * margin - Math.Max(0, column.Count - 1) * gap;
            var desired = column.Sum(b => b.Height - 66);
            var scale = desired == 0 ? 1 : Math.Min(1, (available - column.Count * 66) / desired);
            var y = area.Top + margin;
            foreach (var (box, height) in column)
            {
                var actual = Math.Max(80, 66 + (height - 66) * scale);
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
        var bounds = fallback;
        if (state?.MonitorId.StartsWith("desktop-grouped:", StringComparison.Ordinal) == true &&
            new[] { state.XRatio, state.YRatio, state.WidthRatio, state.HeightRatio }.All(double.IsFinite))
            bounds = new(area.Left + state.XRatio * area.Width, area.Top + state.YRatio * area.Height,
                Math.Clamp(state.WidthRatio * area.Width, 220, Math.Max(220, area.Width)),
                Math.Clamp(state.HeightRatio * area.Height, 80, Math.Max(80, area.Height)));
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
}
