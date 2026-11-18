using System.Windows;
using System.Windows.Media;
using System.Windows.Interop;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace SmartDeskBox.DesktopApp;

public static class InterfaceTheme
{
    private static Color? islandAccent;
    public static event Action? Changed;
    public static bool IsDark { get; private set; }

    public static void SetIslandAccent(string? hexColor, InterfaceSettings? currentSettings = null)
    {
        if (!string.IsNullOrWhiteSpace(hexColor))
        {
            try { islandAccent = (Color)ColorConverter.ConvertFromString(hexColor.Trim()); }
            catch { islandAccent = null; }
        }
        else
        {
            islandAccent = null;
        }
        if (currentSettings is not null) Apply(currentSettings);
    }

    public static void Apply(InterfaceSettings settings)
    {
        IsDark = settings.Theme == "Dark" || settings.Theme == "System" &&
            !Equals(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1), 1);
        string[] keys = ["Page", "Sidebar", "Surface", "SurfaceHover", "Stroke", "Text", "Muted", "Accent", "Selection", "Success", "Danger", "AccentFill", "OnAccent", "InputStroke"];
        string[] values = IsDark
            ? ["#12161E", "#0E1219", "#1C2431", "#263244", "#354258", "#F1F5FC", "#AAB8CC", "#94B8FF", "#253B60", "#80D6B1", "#FFB1B5", "#255EDB", "#FFFFFF", "#6B7C97"]
            : ["#F5F6F9", "#ECEFF5", "#FFFFFF", "#EDF1F8", "#D3DBE8", "#202C40", "#596B84", "#255EDB", "#E1EAFC", "#176B4D", "#B32738", "#255EDB", "#FFFFFF", "#8290A6"];
        var resources = Application.Current.Resources;
        for (int index = 0; index < keys.Length; index++)
        {
            var color = (Color)ColorConverter.ConvertFromString(values[index]);
            if (islandAccent is { } accent)
            {
                if (keys[index] is "Accent" or "AccentFill") color = accent;
                else if (keys[index] == "Selection")
                    color = IsDark
                        ? Color.FromRgb((byte)(accent.R * 0.25 + 18), (byte)(accent.G * 0.25 + 24), (byte)(accent.B * 0.25 + 36))
                        : Color.FromRgb((byte)(accent.R * 0.18 + 205), (byte)(accent.G * 0.18 + 212), (byte)(accent.B * 0.18 + 224));
            }
            Brush brush = new SolidColorBrush(color);
            if (SystemParameters.HighContrast) brush = keys[index] switch
            {
                "Text" or "Muted" or "Success" or "Danger" => SystemColors.WindowTextBrush,
                "Accent" or "AccentFill" => SystemColors.HighlightBrush,
                "OnAccent" => SystemColors.HighlightTextBrush,
                "Stroke" or "InputStroke" => SystemColors.WindowTextBrush,
                "Selection" or "SurfaceHover" => SystemColors.ControlBrush,
                _ => SystemColors.WindowBrush
            };
            else if (brush.CanFreeze) brush.Freeze();
            resources[keys[index]] = brush;
        }
        resources["BodySize"] = settings.TextSize;
        Changed?.Invoke();
    }

    internal static Brush Brush(string name) => (Brush)Application.Current.FindResource(name);
    internal static IntPtr NativeColor(string name)
    {
        var color = ((SolidColorBrush)Brush(name)).Color;
        return new IntPtr(color.R | color.G << 8 | color.B << 16);
    }
    internal static void ApplyChrome(Window window)
    {
        var handle = new WindowInteropHelper(window).Handle;
        if (handle == IntPtr.Zero || !OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041)) return;
        int dark = IsDark && !SystemParameters.HighContrast ? 1 : 0;
        DwmSetWindowAttribute(handle, 20, ref dark, sizeof(int));
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        { int backdrop = SystemParameters.HighContrast ? 1 : 2; DwmSetWindowAttribute(handle, 38, ref backdrop, sizeof(int)); }
    }
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
}
