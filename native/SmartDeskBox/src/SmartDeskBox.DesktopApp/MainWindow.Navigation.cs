using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using SmartDeskBox.Core;

namespace SmartDeskBox.DesktopApp;

public partial class MainWindow
{
    public void ApplyInterfaceSettings(InterfaceSettings settings)
    {
        settings.Validate();
        Interface = settings;
        interfaceWarning = null;
        InterfaceTheme.Apply(settings);
        ApplyNativeBackdrop();
        desktopSession?.ApplySettings(settings);
        ApplyFilters();
    }
    private void SystemThemeChanged(object sender, Microsoft.Win32.UserPreferenceChangedEventArgs e)
    {
        if (Dispatcher.HasShutdownStarted) return;
        Dispatcher.BeginInvoke(() =>
        {
            if (Interface.Theme == "System" || e.Category is Microsoft.Win32.UserPreferenceCategory.Accessibility
                or Microsoft.Win32.UserPreferenceCategory.Color or Microsoft.Win32.UserPreferenceCategory.VisualStyle)
            { InterfaceTheme.Apply(Interface); ApplyNativeBackdrop(); }
        });
    }
    private void SaveQuickSettings(InterfaceSettings settings)
    {
        try { settings.Save(paths); ApplyInterfaceSettings(settings); StatusText.Text = "区块交互设置已保存。"; }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException)
        { StatusText.Text = "设置未保存：" + exception.Message; }
    }
    private void Section_Checked(object sender, RoutedEventArgs e)
    {
        section = ((RadioButton)sender).Tag?.ToString() ?? "All";
        if (SearchBox is not null) ApplyFilters();
    }
    private void Search_Changed(object sender, TextChangedEventArgs e)
    { if (BoxesControl is not null) ApplyFilters(); }

    private void ClearSearch_Click(object sender, RoutedEventArgs e)
    { SearchBox.Clear(); SearchBox.Focus(); }

    private void FocusSearch_CanExecute(object sender, CanExecuteRoutedEventArgs e) => e.CanExecute = !busy;

    private void FocusSearch_Executed(object sender, ExecutedRoutedEventArgs e)
    {
        if (section == "Data") AllNavigation.IsChecked = true;
        SearchBox.Focus(); SearchBox.SelectAll();
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && Keyboard.Modifiers == ModifierKeys.None && SearchBox.IsKeyboardFocusWithin && SearchBox.Text.Length > 0)
        { SearchBox.Clear(); e.Handled = true; }
    }

    private async void EmptyAction_Click(object sender, RoutedEventArgs e)
    {
        if (SearchBox.Text.Trim().Length > 0) ClearSearch_Click(sender, e);
        else if (section == "Pending") AllNavigation.IsChecked = true;
        else await ScanAsync();
    }

    private void ApplyFilters()
    {
        string query = SearchBox.Text.Trim();
        bool data = section == "Data";
        SectionTitle.Text = section switch { "Apps" => "应用", "Files" => "文件", "Pending" => "待确认应用", "Data" => "备份与数据", _ => "全部分类" };
        DataPanel.Visibility = data ? Visibility.Visible : Visibility.Collapsed;
        ActionsPanel.Visibility = data ? Visibility.Collapsed : Visibility.Visible;
        ClearSearchButton.Visibility = SearchBox.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        FilteredBoxes.Clear();
        foreach (var box in Boxes)
        {
            bool categoryMatches = box.Info.Name.Contains(query, StringComparison.OrdinalIgnoreCase);
            box.VisibleItems.Filter = value => value is ItemViewModel item && (categoryMatches ||
                new[] { item.Name, item.FileName, item.Summary, item.Item.Metadata.SourceFilePath }
                    .Any(text => text.Contains(query, StringComparison.OrdinalIgnoreCase)));
            bool included = section switch { "Apps" => !box.IsFile, "Files" => box.IsFile,
                "Pending" => box.Info.Category == AppCategory.PENDING, "Data" => false, _ => true };
            if (included && (!Interface.HideEmpty || box.Items.Count > 0) &&
                (query.Length == 0 || !box.VisibleItems.IsEmpty || categoryMatches)) FilteredBoxes.Add(box);
        }
        int matches = FilteredBoxes.Sum(box => box.VisibleCount);
        SearchResultsText.Text = query.Length > 0
            ? $"找到 {matches} 个项目 · {FilteredBoxes.Count} 个分类"
            : $"当前显示 {matches} 个项目 · {FilteredBoxes.Count} 个分类 · 双击打开，右键更改分类";
        bool empty = FilteredBoxes.Count == 0 || query.Length > 0 && matches == 0;
        EmptyState.Visibility = !data && empty ? Visibility.Visible : Visibility.Collapsed;
        CanvasScroll.Visibility = data || empty ? Visibility.Collapsed : Visibility.Visible;
        EmptyTitle.Text = query.Length > 0 ? "没有匹配的项目" : section == "Pending" ? "所有应用都已确认" : "暂无桌面项目";
        EmptyDescription.Text = query.Length > 0 ? "当前范围内没有匹配结果，试试名称、用途或路径，也可以清空搜索。"
            : section == "Pending" ? "目前没有待确认的应用，可以到全部分类查看已整理的项目。"
            : "当前范围内还没有项目，重新扫描以更新桌面分类。";
        EmptyActionButton.Content = query.Length > 0 ? "清空搜索" : section == "Pending" ? "查看全部分类" : "重新扫描";
    }

    private async void ShowDesktop_Click(object sender, RoutedEventArgs e) => await ShowDesktopAsync();
    private void RestoreDesktop_Click(object sender, RoutedEventArgs e) => desktopSession?.Hide();
    private void OpenData_Click(object sender, RoutedEventArgs e)
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe") { ArgumentList = { Path.Combine(paths.Root, "data") } }); }
        catch (Exception exception) when (exception is IOException or System.ComponentModel.Win32Exception)
        { StatusText.Text = "无法打开数据目录：" + exception.Message; }
    }
    private void ExportReport_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            WorkspacePaths.EnsureNoReparsePoints(paths.ReportPath);
            File.WriteAllText(paths.ReportPath, JsonSerializer.Serialize(classified, AppJsonContext.Default.ListClassifiedItem));
            StatusText.Text = "已导出分类报表：" + paths.ReportPath;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        { StatusText.Text = "导出失败：" + exception.Message; }
    }
}
