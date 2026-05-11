namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record HeartbeatResponse
{
    public DateTimeOffset ServerTimeUtc { get; init; } = DateTimeOffset.UtcNow;

    public string PolicyVersion { get; init; } = string.Empty;

    public int? NextHeartbeatInSeconds { get; init; }
}
