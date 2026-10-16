using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Data;
using SmartDeskBox.Core;

namespace SmartDeskBox.DesktopApp;

public sealed class ItemViewModel(ClassifiedItem item)
{
    public ClassifiedItem Item { get; } = item;
    public string Name => Item.Metadata.DisplayName;
    public string FileName => Item.Metadata.FileName;
    public string Label => Categories.Get(Item.Result.Category).IsFile ? FileName : Name;
    public string Summary => Item.Result.PurposeSummary;
    public string Tier => Item.Result.HitTier switch
    {
        "CACHE" => "缓存", "L1_RULE" => "L1 规则", "L2_DICT" => "L2 字典", "L3_LLM" => "L3 推理",
        "USER_MANUAL" => "手动指定", _ => "L3 离线"
    };
    public string Detail => $"{Summary}\n\n开发商：{Item.Metadata.CompanyName ?? "未提供"}\n产品名：{Item.Metadata.ProductName ?? "未提供"}\n目标：{Item.Metadata.TargetPath ?? Item.Metadata.SourceFilePath}\n来源：{(Item.Metadata.IsPublicDesktop ? "公用桌面" : "个人桌面")}\n置信度：{Item.Result.Confidence:P0}\n\n双击打开 · 右键或拖拽更改分类";
    public ImageSource? Icon { get; } = LoadIcon(item.Metadata);
    public Visibility FallbackVisibility => Icon == null ? Visibility.Visible : Visibility.Collapsed;
    public Visibility ReviewVisibility => Item.Result.Confidence < .65 ? Visibility.Visible : Visibility.Collapsed;

    private static ImageSource? LoadIcon(DesktopItemMetadata item)
    {
        try
        {
            var path = item.TargetPath != null && File.Exists(item.TargetPath) ? item.TargetPath : item.SourceFilePath;
            using var icon = System.Drawing.Icon.ExtractAssociatedIcon(path);
            if (icon == null) return null;
            var image = Imaging.CreateBitmapSourceFromHIcon(icon.Handle, Int32Rect.Empty, BitmapSizeOptions.FromWidthAndHeight(32, 32));
            image.Freeze();
            return image;
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or System.ComponentModel.Win32Exception or UnauthorizedAccessException)
        { return null; }
    }
}

public sealed class CategoryBox : INotifyPropertyChanged
{
    private bool isCollapsed;
    public CategoryInfo Info { get; }
    public bool IsFile => Info.IsFile;
    public ObservableCollection<ItemViewModel> Items { get; } = [];
    public ICollectionView VisibleItems => CollectionViewSource.GetDefaultView(Items);
    public CategoryBox(CategoryInfo info, bool collapsed)
    {
        Info = info; isCollapsed = collapsed;
        Items.CollectionChanged += (_, _) => OnChanged(nameof(BoxHeight));
        VisibleItems.CollectionChanged += (_, _) => { OnChanged(nameof(VisibleCount)); OnChanged(nameof(PreviewHeight)); };
    }
    public bool IsCollapsed
    {
        get => isCollapsed;
        set
        {
            isCollapsed = value;
            OnChanged(); OnChanged(nameof(ContentVisibility)); OnChanged(nameof(ToggleGlyph)); OnChanged(nameof(BoxHeight)); OnChanged(nameof(PreviewHeight));
        }
    }
    public double BoxHeight => IsCollapsed ? 50 : Math.Clamp(76 + Items.Count * 62, 150, 350);
    public int VisibleCount => VisibleItems.Cast<ItemViewModel>().Count();
    public double PreviewHeight => IsCollapsed ? 50 : Math.Clamp(76 + VisibleCount * 62, 150, 350);
    public Visibility ContentVisibility => IsCollapsed ? Visibility.Collapsed : Visibility.Visible;
    public string ToggleGlyph => IsCollapsed ? "+" : "−";
    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnChanged([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
