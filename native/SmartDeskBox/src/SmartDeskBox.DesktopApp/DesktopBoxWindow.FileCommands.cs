using System.Windows.Controls;
using SmartDeskBox.Core;

namespace SmartDeskBox.DesktopApp;

public partial class DesktopBoxWindow
{
    public Func<ItemViewModel, Task>? ResetClassification { get; set; }
    public bool WantsKeyboardFocus => ShellView.ContainsCursor();
    public void ShowFileFeedback(string text) { FeedbackText.Text = text; FeedbackText.ToolTip = text; }

    public void AddClassificationMenu(ContextMenu menu)
    {
        menu.Opened += (_, _) => categoryMenuOpen = true;
        menu.Closed += (_, _) => categoryMenuOpen = false;
        var paths = ShellView.SelectedPaths().ToHashSet(StringComparer.OrdinalIgnoreCase);
        var selected = Box.Items.Where(item => paths.Contains(item.Item.Metadata.SourceFilePath)).ToArray();
        var category = new MenuItem { Header = "更改所选项目分类（不移动文件）", IsEnabled = selected.Length > 0 };
        foreach (var info in Categories.All.Where(info => info.IsFile == Box.IsFile))
        {
            var option = new MenuItem { Header = info.Name };
            option.Click += async (_, _) => { foreach (var item in selected) await reclassify(item, info.Category); };
            category.Items.Add(option);
        }
        menu.Items.Add(new Separator());
        menu.Items.Add(category);
        var reset = new MenuItem { Header = "恢复所选项目自动分类", IsEnabled = selected.Length > 0 && ResetClassification is not null };
        reset.Click += async (_, _) => { foreach (var item in selected) if (ResetClassification is not null) await ResetClassification(item); };
        menu.Items.Add(reset);
    }
}
