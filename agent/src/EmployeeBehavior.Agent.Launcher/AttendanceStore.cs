using System.Text.Encodings.Web;
using System.Text.Json;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed class AttendanceStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false
    };

    private readonly SemaphoreSlim _fileLock = new(1, 1);
    private readonly string _logPath;
    private readonly string _pendingPath;

    public AttendanceStore(string? dataDirectory = null)
    {
        dataDirectory ??= Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "EmployeeBehaviorAgent");
        Directory.CreateDirectory(dataDirectory);
        _logPath = Path.Combine(dataDirectory, "attendance-log.jsonl");
        _pendingPath = Path.Combine(dataDirectory, "attendance-pending.jsonl");
    }

    public string LogPath => _logPath;

    public string PendingPath => _pendingPath;

    public async Task<AttendanceRecord> AppendAsync(
        string eventType,
        EmployeeProfile employeeProfile,
        DateTimeOffset occurredAt)
    {
        var record = AttendanceRecord.Create(eventType, employeeProfile, Environment.MachineName, occurredAt);
        var line = JsonSerializer.Serialize(record, JsonOptions);

        await _fileLock.WaitAsync();
        try
        {
            await File.AppendAllTextAsync(_logPath, line + Environment.NewLine);
            await File.AppendAllTextAsync(_pendingPath, line + Environment.NewLine);
        }
        finally
        {
            _fileLock.Release();
        }

        return record;
    }

    public async Task<IReadOnlyList<AttendanceRecord>> LoadPendingAsync()
    {
        await _fileLock.WaitAsync();
        try
        {
            if (!File.Exists(_pendingPath))
            {
                return Array.Empty<AttendanceRecord>();
            }

            var records = new List<AttendanceRecord>();
            foreach (var line in await File.ReadAllLinesAsync(_pendingPath))
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                try
                {
                    var record = JsonSerializer.Deserialize<AttendanceRecord>(line, JsonOptions);
                    if (record is not null && !string.IsNullOrWhiteSpace(record.Id))
                    {
                        records.Add(record);
                    }
                }
                catch (JsonException)
                {
                    // Skip malformed queue lines so one bad entry does not block future syncs.
                }
            }

            return records;
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task ReplaceReplayedPendingAsync(
        IEnumerable<string> replayedIds,
        IEnumerable<AttendanceRecord> remainingReplayedRecords)
    {
        var replayedIdSet = replayedIds.ToHashSet(StringComparer.Ordinal);
        var remaining = remainingReplayedRecords.ToList();

        await _fileLock.WaitAsync();
        try
        {
            var pendingRecords = new List<AttendanceRecord>();
            if (File.Exists(_pendingPath))
            {
                foreach (var line in await File.ReadAllLinesAsync(_pendingPath))
                {
                    if (string.IsNullOrWhiteSpace(line))
                    {
                        continue;
                    }

                    try
                    {
                        var record = JsonSerializer.Deserialize<AttendanceRecord>(line, JsonOptions);
                        if (record is not null &&
                            !string.IsNullOrWhiteSpace(record.Id) &&
                            !replayedIdSet.Contains(record.Id))
                        {
                            pendingRecords.Add(record);
                        }
                    }
                    catch (JsonException)
                    {
                        // Drop malformed queue entries during compaction.
                    }
                }
            }

            pendingRecords.AddRange(remaining);

            var lines = pendingRecords.Select(record => JsonSerializer.Serialize(record, JsonOptions)).ToArray();
            if (lines.Length == 0)
            {
                if (File.Exists(_pendingPath))
                {
                    File.Delete(_pendingPath);
                }

                return;
            }

            await File.WriteAllLinesAsync(_pendingPath, lines);
        }
        finally
        {
            _fileLock.Release();
        }
    }
}

internal sealed record AttendanceRecord
{
    public string Id { get; init; } = string.Empty;

    public string EventType { get; init; } = string.Empty;

    public string UserName { get; init; } = string.Empty;

    public string? EmployeeNo { get; init; }

    public string? EmployeeDisplayName { get; init; }

    public string? RuleSummary { get; init; }

    public string MachineName { get; init; } = string.Empty;

    public DateTimeOffset OccurredAt { get; init; }

    public DateTimeOffset QueuedAt { get; init; }

    public int AttemptCount { get; init; }

    public DateTimeOffset? LastAttemptAt { get; init; }

    public string? LastError { get; init; }

    public string EmployeeNoOrFallback => string.IsNullOrWhiteSpace(EmployeeNo) ? UserName : EmployeeNo;

    public static AttendanceRecord Create(
        string eventType,
        EmployeeProfile employeeProfile,
        string machineName,
        DateTimeOffset occurredAt)
    {
        return new AttendanceRecord
        {
            Id = Guid.NewGuid().ToString("N"),
            EventType = eventType,
            UserName = employeeProfile.DisplayName,
            EmployeeNo = employeeProfile.EmployeeNo,
            EmployeeDisplayName = employeeProfile.DisplayName,
            RuleSummary = employeeProfile.RuleSummary,
            MachineName = machineName,
            OccurredAt = occurredAt,
            QueuedAt = DateTimeOffset.Now
        };
    }

    public AttendanceRecord MarkAttemptFailed(string error)
    {
        return this with
        {
            AttemptCount = AttemptCount + 1,
            LastAttemptAt = DateTimeOffset.Now,
            LastError = error
        };
    }
}
