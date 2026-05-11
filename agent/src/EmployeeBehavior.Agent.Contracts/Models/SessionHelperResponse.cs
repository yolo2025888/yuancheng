namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record SessionHelperResponse
{
    public bool Success { get; init; }

    public string Error { get; init; } = string.Empty;

    public SessionCaptureEnvelope? Snapshot { get; init; }
}
