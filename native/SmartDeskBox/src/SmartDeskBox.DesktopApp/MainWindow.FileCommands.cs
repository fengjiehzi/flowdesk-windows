using SmartDeskBox.Core;
using SmartDeskBox.Intelligence;

namespace SmartDeskBox.DesktopApp;

public partial class MainWindow
{
    public async Task<bool> AcceptShellItemsAsync(IReadOnlyList<string> sources, AppCategory target)
    {
        if (busy) return false;
        await RunActionAsync("正在归类 Windows 新项目…", async () =>
        {
            var metadata = sources.Where(path => File.Exists(path) || Directory.Exists(path)).Select(path => new MetadataExtractor().Extract(path)).ToList();
            var results = await pipeline.ClassifyAsync(metadata);
            int assigned = 0;
            foreach (var item in results.Where(item => Categories.Get(item.Result.Category).IsFile == Categories.Get(target).IsFile))
            { pipeline.SetManual(item.Metadata, target); assigned++; }
            await ScanCoreAsync();
            StatusText.Text = $"Windows 操作已完成 · {assigned} 项归入当前分类" + (assigned < results.Count ? "，不同类型项目按规则分类。" : "。");
        });
        return true;
    }

    public Task ResetClassificationAsync(ItemViewModel item) => RunActionAsync("正在恢复自动分类…", async () =>
    {
        pipeline.ResetManual(item.Item.Metadata);
        await ScanCoreAsync();
        StatusText.Text = "已恢复自动分类。";
    });
}
