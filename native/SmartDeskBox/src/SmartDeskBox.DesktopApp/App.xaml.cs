using System.Windows;
using System.Threading;
using SmartDeskBox.Core;

namespace SmartDeskBox.DesktopApp;

public partial class App : Application
{
    private Mutex? instance;
    private readonly bool startDesktop;
    private IslandHost? islandHost;
    public App() : this(true) { }
    public App(bool startDesktop) => this.startDesktop = startDesktop;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (!startDesktop) return;
        if (e.Args.Length == 5 && e.Args[0] == "--icon-guardian")
        {
            try { DesktopIconLease.RunGuardian(e.Args); Shutdown(0); }
            catch (Exception) { Shutdown(1); }
            return;
        }
        var embedded = e.Args.Contains("--island") || e.Args.Contains("--island-probe");
        var mutexName = e.Args.Contains("--island-probe") ? $"Local\\SmartDeskBox.Probe.{Environment.ProcessId}" : "Local\\SmartDeskBox.DesktopSession";
        instance = new Mutex(true, mutexName, out var created);
        if (!created)
        {
            if (embedded) IslandHost.WriteStartupError("已有桌面整理实例正在运行，请先退出旧版 SmartDeskBox。");
            Shutdown(); return;
        }
        try
        {
            var dataIndex = Array.IndexOf(e.Args, "--island-data");
            if (embedded && (dataIndex < 0 || dataIndex + 1 >= e.Args.Length))
                throw new ArgumentException("内置模式缺少用户数据目录。");
            var workspace = embedded ? new WorkspacePaths(e.Args[dataIndex + 1]) : WorkspacePaths.Discover();
            var window = new MainWindow(workspace, false, embedded);
            MainWindow = window;
            if (!e.Args.Contains("--island-probe")) await window.StartDesktopAsync(show: !embedded || e.Args.Contains("--show"));
            if (embedded)
            {
                islandHost = new IslandHost(window, e.Args.Contains("--island-probe"));
                islandHost.Start();
            }
            if (e.Args.Contains("--manage")) { window.Show(); window.Activate(); }
        }
        catch (Exception ex)
        {
            if (embedded) IslandHost.WriteStartupError(ex.Message);
            else MessageBox.Show(ex.Message, "桌面分区启动失败", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        islandHost?.Dispose();
        instance?.Dispose();
        base.OnExit(e);
    }
}
