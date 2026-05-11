namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record ScreenshotUploadCompleteRequest
{
    public string DeviceId { get; init; } = string.Empty;

    public string ScreenshotId { get; init; } = string.Empty;

    public DateTimeOffset CompletedAtUtc { get; init; } = DateTimeOffset.UtcNow;
}
