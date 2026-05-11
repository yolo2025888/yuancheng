namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record SessionStateSnapshot
{
    public DateTimeOffset CollectedAtUtc { get; init; } = DateTimeOffset.UtcNow;

    public int SessionId { get; init; }

    public string UserName { get; init; } = string.Empty;

    public bool IsLocked { get; init; }

    public bool IsRemoteSession { get; init; }

    public bool IsRdpSession { get; init; }

    public bool IsActiveSession { get; init; }

    public bool IsConsoleSession { get; init; }

    public int ActiveConsoleSessionId { get; init; }

    public int IdleSeconds { get; init; }

    public string InputDesktopName { get; init; } = string.Empty;

    public string SessionConnectState { get; init; } = string.Empty;

    public string StatusDetail { get; init; } = string.Empty;
}
