namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record SessionHelperRequest
{
    public const string CaptureSnapshotCommand = "capture-session";

    public string Command { get; init; } = CaptureSnapshotCommand;
}
