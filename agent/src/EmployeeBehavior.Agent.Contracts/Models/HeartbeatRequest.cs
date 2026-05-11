namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record HeartbeatRequest
{
    public string DeviceId { get; init; } = string.Empty;

    public string? EmployeeId { get; init; }

    public string Hostname { get; init; } = Environment.MachineName;

    public string? OsType { get; init; } = Environment.OSVersion.VersionString;

    public string AgentVersion { get; init; } = string.Empty;

    public int ScreenCount { get; init; } = 1;

    public string Status { get; init; } = "online";

    public DateTimeOffset SentAtUtc { get; init; } = DateTimeOffset.UtcNow;

    public string CurrentPolicyVersion { get; init; } = string.Empty;

    public SessionStateSnapshot? SessionState { get; init; }

    public ForegroundWindowInfo? ForegroundWindow { get; init; }

    public InputActivitySnapshot? InputActivity { get; init; }
}
