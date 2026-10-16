# 灵动岛桌面整理模块

从本机 `E:\Vibe-Flow\SmartDeskBox` 的独立 WPF 实现迁入，包含 Core、Intelligence 和 DesktopApp；未使用 SmartDeskBox.Next 的 DeskBox 派生实现。

灵动岛通过重定向标准输入/输出的逐行 JSON 协议控制模块，原生窗口负责桌面层挂接、Windows Shell 文件视图、分类管理、设置和备份。内置模式不显示第二个托盘图标。父进程退出时自动恢复桌面；现有独立图标守护进程继续提供崩溃恢复。

用户数据由主进程指定到 Electron `userData/desktop-boxes`，不写入安装目录，也不读取或覆盖旧项目的数据库、凭据和配置。AI 默认关闭，只有在桌面整理设置中启用才调用网络。

开发依赖 .NET 10 SDK。执行 `npm run desktop:build` 仅发布本模块，产物在 `build/generated/desktop-boxes`。正式打包自动发布自包含 win-x64 模块，不要求目标机器安装 .NET。内置命令：`show`、`hide`、`manage`、`settings`、`refresh`、`state`、`exit`。

`--island-probe --island-data <path>` 是协议测试模式：不扫描或挂接真实桌面，只在指定隔离目录初始化模块，用于检查状态、无效命令和退出。
