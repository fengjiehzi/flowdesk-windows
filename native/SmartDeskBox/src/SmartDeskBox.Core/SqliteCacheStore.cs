using Microsoft.Data.Sqlite;

namespace SmartDeskBox.Core;

public sealed class SqliteCacheStore
{
    private readonly string connectionString;

    public SqliteCacheStore(string databasePath)
    {
        WorkspacePaths.EnsureNoReparsePoints(databasePath);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(databasePath))!);
        connectionString = new SqliteConnectionStringBuilder { DataSource = databasePath }.ToString();
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS manual_classification (
                source_path TEXT PRIMARY KEY, category TEXT NOT NULL,
                purpose_summary TEXT NOT NULL, updated_unix_sec INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS app_classification_cache (
                signature_hash TEXT PRIMARY KEY, display_name TEXT NOT NULL, target_path TEXT,
                company_name TEXT, product_name TEXT, category TEXT NOT NULL, purpose_summary TEXT NOT NULL,
                hit_tier TEXT NOT NULL, updated_unix_sec INTEGER NOT NULL, confidence REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS file_transaction_log (
                tx_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL, item_name TEXT NOT NULL,
                source_path TEXT NOT NULL, destination_path TEXT NOT NULL, category TEXT NOT NULL,
                operation_mode TEXT NOT NULL, status TEXT NOT NULL, created_unix_sec INTEGER NOT NULL,
                backup_path TEXT NOT NULL, content_hash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS box_layout_state (
                category TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, x_ratio REAL NOT NULL,
                y_ratio REAL NOT NULL, width_ratio REAL NOT NULL, height_ratio REAL NOT NULL,
                is_collapsed INTEGER NOT NULL DEFAULT 0);
            """;
        command.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        return connection;
    }

    public ClassificationResult? Find(DesktopItemMetadata item, bool preserveTier = false)
    {
        using var connection = Open();
        using (var manual = connection.CreateCommand())
        {
            manual.CommandText = "SELECT category,purpose_summary FROM manual_classification WHERE source_path=$source";
            manual.Parameters.AddWithValue("$source", Path.GetFullPath(item.SourceFilePath).ToLowerInvariant());
            using var row = manual.ExecuteReader();
            if (row.Read()) return new(item.ItemId, item.SignatureHash, Enum.Parse<AppCategory>(row.GetString(0)), 1, "USER_MANUAL", row.GetString(1));
        }
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT category,confidence,hit_tier,purpose_summary,display_name FROM app_classification_cache WHERE signature_hash=$hash";
        command.Parameters.AddWithValue("$hash", item.SignatureHash);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        // Legacy shared-target preferences are adopted only for the original display name.
        if (reader.GetString(2) == "USER_MANUAL" && !reader.GetString(4).Equals(item.DisplayName, StringComparison.OrdinalIgnoreCase)) return null;
        return new(item.ItemId, item.SignatureHash, Enum.Parse<AppCategory>(reader.GetString(0)),
            reader.GetDouble(1), preserveTier || reader.GetString(2) == "USER_MANUAL" ? reader.GetString(2) : "CACHE", reader.GetString(3));
    }

    public void Save(DesktopItemMetadata item, ClassificationResult result)
    {
        using var connection = Open();
        if (result.HitTier == "USER_MANUAL")
        {
            using var manual = connection.CreateCommand();
            manual.CommandText = """
                INSERT INTO manual_classification VALUES ($source,$category,$summary,$time)
                ON CONFLICT(source_path) DO UPDATE SET category=excluded.category,
                    purpose_summary=excluded.purpose_summary,updated_unix_sec=excluded.updated_unix_sec
                """;
            manual.Parameters.AddWithValue("$source", Path.GetFullPath(item.SourceFilePath).ToLowerInvariant());
            manual.Parameters.AddWithValue("$category", result.Category.ToString());
            manual.Parameters.AddWithValue("$summary", result.PurposeSummary);
            manual.Parameters.AddWithValue("$time", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            manual.ExecuteNonQuery();
            return;
        }
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO app_classification_cache VALUES ($hash,$name,$target,$company,$product,$category,$summary,$tier,$time,$confidence)
            ON CONFLICT(signature_hash) DO UPDATE SET category=excluded.category,purpose_summary=excluded.purpose_summary,
                hit_tier=excluded.hit_tier,updated_unix_sec=excluded.updated_unix_sec,confidence=excluded.confidence
            WHERE app_classification_cache.hit_tier != 'USER_MANUAL' OR excluded.hit_tier = 'USER_MANUAL'
            """;
        command.Parameters.AddWithValue("$hash", item.SignatureHash);
        command.Parameters.AddWithValue("$name", item.DisplayName);
        command.Parameters.AddWithValue("$target", (object?)item.TargetPath ?? DBNull.Value);
        command.Parameters.AddWithValue("$company", (object?)item.CompanyName ?? DBNull.Value);
        command.Parameters.AddWithValue("$product", (object?)item.ProductName ?? DBNull.Value);
        command.Parameters.AddWithValue("$category", result.Category.ToString());
        command.Parameters.AddWithValue("$summary", result.PurposeSummary);
        command.Parameters.AddWithValue("$tier", result.HitTier);
        command.Parameters.AddWithValue("$time", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        command.Parameters.AddWithValue("$confidence", result.Confidence);
        command.ExecuteNonQuery();
    }

    public void ResetManual(DesktopItemMetadata item)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            DELETE FROM manual_classification WHERE source_path=$source;
            DELETE FROM app_classification_cache WHERE signature_hash=$hash AND hit_tier='USER_MANUAL' AND display_name=$name;
            """;
        command.Parameters.AddWithValue("$source", Path.GetFullPath(item.SourceFilePath).ToLowerInvariant());
        command.Parameters.AddWithValue("$hash", item.SignatureHash);
        command.Parameters.AddWithValue("$name", item.DisplayName);
        command.ExecuteNonQuery();
    }

    public void TransferManual(string source, string destination, bool move)
    {
        source = Path.GetFullPath(source).ToLowerInvariant();
        destination = Path.GetFullPath(destination).ToLowerInvariant();
        if (source == destination) return;
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO manual_classification SELECT $destination,category,purpose_summary,updated_unix_sec
                FROM manual_classification WHERE source_path=$source
                ON CONFLICT(source_path) DO UPDATE SET category=excluded.category,purpose_summary=excluded.purpose_summary;
            """;
        command.Parameters.AddWithValue("$source", source);
        command.Parameters.AddWithValue("$destination", destination);
        command.ExecuteNonQuery();
        if (move)
        {
            command.CommandText = "DELETE FROM manual_classification WHERE source_path=$source";
            command.ExecuteNonQuery();
        }
        transaction.Commit();
    }

    public void AddTransactions(IReadOnlyList<FileTransaction> records)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        foreach (var record in records)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO file_transaction_log (batch_id,item_name,source_path,destination_path,category,
                    operation_mode,status,created_unix_sec,backup_path,content_hash)
                VALUES ($batch,$name,$source,$destination,$category,$mode,'COMPLETED',$time,$backup,$hash)
                """;
            command.Parameters.AddWithValue("$batch", record.BatchId);
            command.Parameters.AddWithValue("$name", record.ItemName);
            command.Parameters.AddWithValue("$source", record.SourcePath);
            command.Parameters.AddWithValue("$destination", record.DestinationPath);
            command.Parameters.AddWithValue("$category", record.Category.ToString());
            command.Parameters.AddWithValue("$mode", record.OperationMode);
            command.Parameters.AddWithValue("$time", record.CreatedUnixSec);
            command.Parameters.AddWithValue("$backup", record.BackupPath);
            command.Parameters.AddWithValue("$hash", record.ContentHash);
            command.ExecuteNonQuery();
        }
        transaction.Commit();
    }

    public List<FileTransaction> GetCompletedTransactions(string? batchId = null)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT tx_id,batch_id,item_name,source_path,destination_path,category,operation_mode,status,
                created_unix_sec,backup_path,content_hash FROM file_transaction_log
            WHERE status='COMPLETED' AND ($batch IS NULL OR batch_id=$batch) ORDER BY tx_id DESC
            """;
        command.Parameters.AddWithValue("$batch", (object?)batchId ?? DBNull.Value);
        using var reader = command.ExecuteReader();
        var records = new List<FileTransaction>();
        while (reader.Read()) records.Add(new(reader.GetInt64(0), reader.GetString(1), reader.GetString(2),
            reader.GetString(3), reader.GetString(4), Enum.Parse<AppCategory>(reader.GetString(5)),
            reader.GetString(6), reader.GetString(7), reader.GetInt64(8), reader.GetString(9), reader.GetString(10)));
        return records;
    }

    public void MarkRolledBack(string batchId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE file_transaction_log SET status='ROLLED_BACK' WHERE batch_id=$batch";
        command.Parameters.AddWithValue("$batch", batchId);
        command.ExecuteNonQuery();
    }

    public void UpdateDestination(long txId, string destination, AppCategory category)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "UPDATE file_transaction_log SET destination_path=$path,category=$category WHERE tx_id=$id";
        command.Parameters.AddWithValue("$path", destination);
        command.Parameters.AddWithValue("$category", category.ToString());
        command.Parameters.AddWithValue("$id", txId);
        command.ExecuteNonQuery();
    }

    public BoxLayoutState? GetLayout(AppCategory category)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT monitor_id,x_ratio,y_ratio,width_ratio,height_ratio,is_collapsed FROM box_layout_state WHERE category=$category";
        command.Parameters.AddWithValue("$category", category.ToString());
        using var reader = command.ExecuteReader();
        return reader.Read() ? new(category, reader.GetString(0), reader.GetDouble(1), reader.GetDouble(2),
            reader.GetDouble(3), reader.GetDouble(4), reader.GetInt64(5) != 0) : null;
    }

    public void SaveLayout(BoxLayoutState layout)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT OR REPLACE INTO box_layout_state VALUES ($category,$monitor,$x,$y,$width,$height,$collapsed)";
        command.Parameters.AddWithValue("$category", layout.Category.ToString());
        command.Parameters.AddWithValue("$monitor", layout.MonitorId);
        command.Parameters.AddWithValue("$x", layout.XRatio);
        command.Parameters.AddWithValue("$y", layout.YRatio);
        command.Parameters.AddWithValue("$width", layout.WidthRatio);
        command.Parameters.AddWithValue("$height", layout.HeightRatio);
        command.Parameters.AddWithValue("$collapsed", layout.IsCollapsed ? 1 : 0);
        command.ExecuteNonQuery();
    }
}
