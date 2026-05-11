namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record ScreenshotUploadResponse
{
    public string ScreenshotId { get; init; } = Guid.NewGuid().ToString("N");

    public string Status { get; init; } = "accepted";

    public string ImageUri { get; init; } = string.Empty;

    public string ThumbUri { get; init; } = string.Empty;
}
