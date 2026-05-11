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

    private readonly string _logPath;

    public AttendanceStore()
    {
        var dataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "EmployeeBehaviorAgent");
        Directory.CreateDirectory(dataDirectory);
        _logPath = Path.Combine(dataDirectory, "attendance-log.jsonl");
    }

    public string LogPath => _logPath;

    public async Task AppendAsync(string eventType, string userName, DateTimeOffset occurredAt)
    {
        var record = new AttendanceRecord(eventType, userName, Environment.MachineName, occurredAt);
        var line = JsonSerializer.Serialize(record, JsonOptions);
        await File.AppendAllTextAsync(_logPath, line + Environment.NewLine);
    }
}

internal sealed record AttendanceRecord(
    string EventType,
    string UserName,
    string MachineName,
    DateTimeOffset OccurredAt);
