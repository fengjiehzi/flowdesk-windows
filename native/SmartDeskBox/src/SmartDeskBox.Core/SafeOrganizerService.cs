using System.Security.Cryptography;
using System.Text.Json;

namespace SmartDeskBox.Core;

public sealed class SafeOrganizerService(WorkspacePaths paths, SqliteCacheStore store)
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<OrganizeReport> OrganizeDesktopAsync(IReadOnlyList<ClassifiedItem> items)
    {
        await gate.WaitAsync();
        try { return await Task.Run(() => Organize(items)); }
        finally { gate.Release(); }
    }

    private OrganizeReport Organize(IReadOnlyList<ClassifiedItem> items)
    {
        var batch = Guid.NewGuid().ToString("N")[..8];
        var backupRoot = paths.RequireSandboxPath(Path.Combine(paths.SandboxRoot, "Original_Backup", batch));
        var records = new List<FileTransaction>();
        var createdFiles = new List<string>();
        var copied = 0;
        var placeholders = 0;
        try
        {
            Directory.CreateDirectory(backupRoot);
            foreach (var category in Categories.All)
                Directory.CreateDirectory(paths.RequireSandboxPath(Path.Combine(paths.SandboxRoot, "Modular_Boxes", category.Category.ToString())));
            foreach (var entry in items.DistinctBy(x => x.Metadata.ItemId))
            {
                var item = entry.Metadata;
                var source = Path.GetFullPath(item.SourceFilePath);
                if (WorkspacePaths.IsWithin(source, paths.SandboxRoot))
                    throw new IOException("扫描来源不能是整理沙盒。");
                var attributes = File.GetAttributes(source);
                var placeholder = (attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 ||
                    (item.Extension is not (".lnk" or ".url") && new FileInfo(source).Length >= 5 * 1024 * 1024);
                var name = Path.GetFileName(source) + (placeholder ? ".metadata_placeholder" : "");
                var id = DesktopItemMetadata.Hash(source.ToLowerInvariant())[..16];
                var backup = paths.RequireSandboxPath(Path.Combine(backupRoot, id, name));
                var destination = paths.RequireSandboxPath(Path.Combine(paths.SandboxRoot, "Modular_Boxes",
                    entry.Result.Category.ToString(), batch, id, name));
                Directory.CreateDirectory(Path.GetDirectoryName(backup)!);
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                createdFiles.Add(backup);
                if (placeholder)
                {
                    File.WriteAllText(backup, JsonSerializer.Serialize(item, AppJsonContext.Default.DesktopItemMetadata));
                    placeholders++;
                }
                else
                {
                    File.Copy(source, backup, false);
                    File.SetAttributes(backup, File.GetAttributes(backup) & ~FileAttributes.ReadOnly);
                    copied++;
                }
                createdFiles.Add(destination);
                File.Copy(backup, destination, false);
                records.Add(new(0, batch, item.FileName, source, destination, entry.Result.Category,
                    placeholder ? "VIRTUAL_MAP" : "SANDBOX_COPY", "COMPLETED", DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    backup, HashFile(backup)));
            }
            store.AddTransactions(records);
            return new(batch, copied, placeholders, paths.SandboxRoot);
        }
        catch
        {
            foreach (var file in createdFiles.AsEnumerable().Reverse())
                if (File.Exists(file)) File.Delete(paths.RequireSandboxPath(file));
            throw;
        }
    }

    public async Task<RollbackReport> RollbackBatchAsync(string? batchId = null)
    {
        await gate.WaitAsync();
        try
        {
            return await Task.Run(() =>
            {
                var batch = batchId ?? store.GetCompletedTransactions().FirstOrDefault()?.BatchId;
                if (batch == null) return new RollbackReport(null, 0);
                var records = store.GetCompletedTransactions(batch);
                // Validate the entire batch before deleting anything; user edits must survive rollback.
                foreach (var record in records)
                {
                    ValidateBackup(record);
                    var destination = paths.RequireSandboxPath(record.DestinationPath);
                    if (File.Exists(destination) && HashFile(destination) != record.ContentHash)
                        throw new IOException("沙盒文件已被修改，已保留：" + destination);
                }
                foreach (var record in records)
                    if (File.Exists(record.DestinationPath)) File.Delete(paths.RequireSandboxPath(record.DestinationPath));
                store.MarkRolledBack(batch);
                return new RollbackReport(batch, records.Count);
            });
        }
        finally { gate.Release(); }
    }

    public async Task ReclassifySandboxAsync(DesktopItemMetadata item, AppCategory category)
    {
        await gate.WaitAsync();
        try
        {
            await Task.Run(() =>
            {
                var records = store.GetCompletedTransactions().Where(r =>
                    r.SourcePath.Equals(item.SourceFilePath, StringComparison.OrdinalIgnoreCase)).ToList();
                foreach (var record in records)
                {
                    if (record.Category == category) continue;
                    ValidateBackup(record);
                    var oldPath = paths.RequireSandboxPath(record.DestinationPath);
                    if (!File.Exists(oldPath) || HashFile(oldPath) != record.ContentHash)
                        throw new IOException("沙盒副本缺失或已被修改，无法移动：" + oldPath);
                    var newPath = paths.RequireSandboxPath(Path.Combine(paths.SandboxRoot, "Modular_Boxes",
                        category.ToString(), record.BatchId, new DirectoryInfo(Path.GetDirectoryName(oldPath)!).Name,
                        Path.GetFileName(oldPath)));
                    Directory.CreateDirectory(Path.GetDirectoryName(newPath)!);
                    File.Move(oldPath, newPath, false);
                    try { store.UpdateDestination(record.TxId, newPath, category); }
                    catch { File.Move(newPath, oldPath, false); throw; }
                }
            });
        }
        finally { gate.Release(); }
    }

    private void ValidateBackup(FileTransaction record)
    {
        var backup = paths.RequireSandboxPath(record.BackupPath);
        var destination = paths.RequireSandboxPath(record.DestinationPath);
        if (!WorkspacePaths.IsWithin(backup, Path.Combine(paths.SandboxRoot, "Original_Backup")) ||
            !WorkspacePaths.IsWithin(destination, Path.Combine(paths.SandboxRoot, "Modular_Boxes")))
            throw new InvalidOperationException("事务路径不属于备份区与归类区。");
        if (!File.Exists(backup) || HashFile(backup) != record.ContentHash)
            throw new IOException("原始备份缺失或校验失败：" + backup);
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream));
    }
}
