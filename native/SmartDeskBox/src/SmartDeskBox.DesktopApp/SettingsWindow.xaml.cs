using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using SmartDeskBox.Core;
using SmartDeskBox.Intelligence;

namespace SmartDeskBox.DesktopApp;

public partial class SettingsWindow : Window
{
    private readonly WorkspacePaths paths;
    private readonly List<ClassifiedItem> items;
    public LlmSettings Settings { get; private set; }
    public InterfaceSettings Interface { get; private set; }
    private string section = "Appearance";

    public SettingsWindow(WorkspacePaths paths, LlmSettings settings, List<ClassifiedItem> items, InterfaceSettings? interfaceSettings = null)
    {
        this.paths = paths;
        this.items = items;
        Settings = settings;
        Interface = interfaceSettings ?? InterfaceSettings.Load(paths);
        InitializeComponent();
        SourceInitialized += (_, _) => ApplyChrome();
        InterfaceTheme.Changed += ApplyChrome;
        Closed += (_, _) => InterfaceTheme.Changed -= ApplyChrome;
        SetInterfaceControls(Interface);
        EnabledBox.IsChecked = settings.Enabled;
        BaseUrlBox.Text = settings.BaseUrl;
        ModelBox.Text = settings.Model;
        ApiKeyBox.Password = settings.LlmApiKey;
        AiFields.IsEnabled = settings.Enabled;
        DataPathBox.Text = Path.Combine(paths.Root, "data");
        FilterSections();
    }
    private void ApplyChrome() => InterfaceTheme.ApplyChrome(this);

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var settings = new LlmSettings { Enabled = EnabledBox.IsChecked == true, BaseUrl = BaseUrlBox.Text.Trim(), Model = ModelBox.Text.Trim(), LlmApiKey = ApiKeyBox.Password.Trim() };
            var appearance = new InterfaceSettings
            {
                Theme = ((ComboBoxItem)ThemeBox.SelectedItem).Tag.ToString()!, TextSize = TextSizeSlider.Value,
                SnapEnabled = SnapBox.IsChecked == true, LockLayout = LockBox.IsChecked == true,
                HoverExpand = HoverBox.IsChecked == true, DragExpand = DragExpandBox.IsChecked == true,
                HideEmpty = HideEmptyBox.IsChecked == true, AutoRefresh = AutoRefreshBox.IsChecked == true
            };
            appearance.Validate();
            settings.Validate();
            var path = Path.Combine(paths.Root, "appsettings.local.json");
            WorkspacePaths.EnsureNoReparsePoints(path);
            WorkspacePaths.EnsureNoReparsePoints(path + ".tmp");
            CredentialVault.Write(paths, settings.BaseUrl, settings.LlmApiKey);
            File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(settings with { LlmApiKey = "" }, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(path + ".tmp", path, true);
            appearance.Save(paths);
            Settings = settings;
            Interface = appearance;
            DialogResult = true;
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        { FeedbackText.SetResourceReference(TextBlock.ForegroundProperty, "Danger"); FeedbackText.Text = "设置未全部保存：" + ex.Message; }
    }

    private void Export_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            WorkspacePaths.EnsureNoReparsePoints(paths.ReportPath);
            File.WriteAllText(paths.ReportPath, JsonSerializer.Serialize(items, AppJsonContext.Default.ListClassifiedItem));
            FeedbackText.Text = "已导出至：" + paths.ReportPath;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { FeedbackText.Text = "导出失败：" + ex.Message; }
    }

    private void SetInterfaceControls(InterfaceSettings value)
    {
        ThemeBox.SelectedItem = ThemeBox.Items.OfType<ComboBoxItem>().Single(item => Equals(item.Tag, value.Theme));
        TextSizeSlider.Value = value.TextSize;
        SnapBox.IsChecked = value.SnapEnabled; LockBox.IsChecked = value.LockLayout;
        HoverBox.IsChecked = value.HoverExpand; DragExpandBox.IsChecked = value.DragExpand;
        HideEmptyBox.IsChecked = value.HideEmpty; AutoRefreshBox.IsChecked = value.AutoRefresh;
    }
    private void ResetInterface_Click(object sender, RoutedEventArgs e)
    {
        SetInterfaceControls(new());
        FeedbackText.Text = "已恢复界面默认选项，点击保存后生效。AI 配置和分类偏好保持不变。";
    }
    private void Section_Checked(object sender, RoutedEventArgs e)
    {
        section = ((RadioButton)sender).Tag?.ToString() ?? "Appearance";
        if (SettingsSearch is not null && SettingsSections is not null) { SettingsSearch.Clear(); FilterSections(); }
    }
    private void Search_Changed(object sender, TextChangedEventArgs e)
    {
        if (SettingsSections is null) return;
        foreach (var button in LogicalNavigation(this))
            button.IsChecked = SettingsSearch.Text.Length == 0 && Equals(button.Tag, section);
        FilterSections();
    }
    private static IEnumerable<RadioButton> LogicalNavigation(DependencyObject parent)
    {
        foreach (var child in LogicalTreeHelper.GetChildren(parent).OfType<DependencyObject>())
        {
            if (child is RadioButton button) yield return button;
            foreach (var nested in LogicalNavigation(child)) yield return nested;
        }
    }
    private void FilterSections()
    {
        string query = SettingsSearch.Text.Trim();
        int shown = 0;
        foreach (var card in SettingsSections.Children.OfType<FrameworkElement>())
        {
            string tag = card.Tag?.ToString() ?? "";
            bool visible = query.Length > 0 ? tag.Contains(query, StringComparison.OrdinalIgnoreCase) : tag.StartsWith(section + "|", StringComparison.Ordinal);
            card.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            if (visible) shown++;
        }
        NoResults.Visibility = shown == 0 ? Visibility.Visible : Visibility.Collapsed;
    }
    private void AiEnabled_Changed(object sender, RoutedEventArgs e)
    { if (AiFields is not null) AiFields.IsEnabled = EnabledBox.IsChecked == true; }
}
