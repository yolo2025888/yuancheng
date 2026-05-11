namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record HeartbeatRequest
{
    public string DeviceId { get; init; } = string.Empty;

    public string AgentVersion { get; init; } = string.Empty;

    public DateTimeOffset SentAtUtc { get; init; } = DateTimeOffset.UtcNow;

    public string CurrentPolicyVersion { get; init; } = string.Empty;

    public SessionStateSnapshot? SessionState { get; init; }

    public ForegroundWindowInfo? ForegroundWindow { get; init; }

    public InputActivitySnapshot? InputActivity { get; init; }
}
