namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record ForegroundWindowInfo
{
    public DateTimeOffset CollectedAtUtc { get; init; } = DateTimeOffset.UtcNow;

    public string WindowTitle { get; init; } = string.Empty;

    public string ProcessName { get; init; } = string.Empty;

    public string ExecutablePath { get; init; } = string.Empty;
}
