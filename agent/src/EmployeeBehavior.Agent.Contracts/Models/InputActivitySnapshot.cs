namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record InputActivitySnapshot
{
    public DateTimeOffset CollectedFromUtc { get; init; } = DateTimeOffset.UtcNow;

    public DateTimeOffset CollectedToUtc { get; init; } = DateTimeOffset.UtcNow;

    public long KeyboardEventCount { get; init; }

    public long MouseEventCount { get; init; }

    public long WindowSwitchCount { get; init; }
}
