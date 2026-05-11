namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record ScreenshotUploadResponse
{
    public string ScreenshotId { get; init; } = Guid.NewGuid().ToString("N");

    public string Status { get; init; } = "accepted";
}
