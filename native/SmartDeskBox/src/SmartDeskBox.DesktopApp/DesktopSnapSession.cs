using System.Windows;

namespace SmartDeskBox.DesktopApp;

public sealed class DesktopSnapSession(Rect origin, IReadOnlyList<Rect> neighbors, double scaleX, double scaleY)
{
    private double? heldX, heldY;
    public Rect Origin => origin;
    public bool IsSnapped => heldX.HasValue || heldY.HasValue;

    public Rect Resolve(Vector displacement, Rect area, bool resize, bool bypass)
    {
        var proposed = origin;
        if (resize)
        {
            proposed.Width = Math.Clamp(origin.Width + displacement.X, 220 * scaleX, Math.Max(220 * scaleX, area.Right - origin.Left));
            proposed.Height = Math.Clamp(origin.Height + displacement.Y, 130 * scaleY, Math.Max(130 * scaleY, area.Bottom - origin.Top));
        }
        else
        {
            proposed.Offset(displacement);
            proposed.X = Math.Clamp(proposed.X, area.Left, Math.Max(area.Left, area.Right - proposed.Width));
            proposed.Y = Math.Clamp(proposed.Y, area.Top, Math.Max(area.Top, area.Bottom - proposed.Height));
        }
        if (bypass) { heldX = heldY = null; return proposed; }

        var xs = new List<double>();
        var ys = new List<double>();
        if (resize) { xs.Add(area.Right); ys.Add(area.Bottom); }
        else
        {
            xs.AddRange([area.Left, area.Right - proposed.Width]);
            ys.AddRange([area.Top, area.Bottom - proposed.Height]);
        }
        foreach (var neighbor in neighbors)
        {
            if (Gap(proposed.Top, proposed.Bottom, neighbor.Top, neighbor.Bottom) <= 20 * scaleY)
            {
                if (resize) xs.AddRange([neighbor.Left, neighbor.Right, neighbor.Left - 14 * scaleX]);
                else xs.AddRange([neighbor.Left, neighbor.Right - proposed.Width,
                    neighbor.Left - 14 * scaleX - proposed.Width, neighbor.Right + 14 * scaleX]);
            }
            if (Gap(proposed.Left, proposed.Right, neighbor.Left, neighbor.Right) <= 20 * scaleX)
            {
                if (resize) ys.AddRange([neighbor.Top, neighbor.Bottom, neighbor.Top - 14 * scaleY]);
                else ys.AddRange([neighbor.Top, neighbor.Bottom - proposed.Height,
                    neighbor.Top - 14 * scaleY - proposed.Height, neighbor.Bottom + 14 * scaleY]);
            }
        }
        double x = resize ? proposed.Right : proposed.Left, y = resize ? proposed.Bottom : proposed.Top;
        heldX = Snap(x, xs, heldX, scaleX,
            resize ? proposed.Left + 220 * scaleX : area.Left,
            resize ? area.Right : Math.Max(area.Left, area.Right - proposed.Width));
        heldY = Snap(y, ys, heldY, scaleY,
            resize ? proposed.Top + 130 * scaleY : area.Top,
            resize ? area.Bottom : Math.Max(area.Top, area.Bottom - proposed.Height));
        if (resize)
        {
            proposed.Width = (heldX ?? x) - proposed.Left;
            proposed.Height = (heldY ?? y) - proposed.Top;
        }
        else { proposed.X = heldX ?? x; proposed.Y = heldY ?? y; }
        return proposed;
    }

    private static double Gap(double a, double b, double c, double d) => Math.Max(0, Math.Max(c - b, a - d));

    private static double? Snap(double value, List<double> candidates, double? held, double scale, double min, double max)
    {
        // A wider release distance keeps tiny pointer movements from flickering between edges.
        if (held is { } previous && previous >= min && previous <= max && Math.Abs(value - previous) <= 18 * scale)
            return previous;
        return candidates.Where(candidate => candidate >= min && candidate <= max && Math.Abs(candidate - value) <= 8 * scale)
            .OrderBy(candidate => Math.Abs(candidate - value)).Select(candidate => (double?)candidate).FirstOrDefault();
    }
}
