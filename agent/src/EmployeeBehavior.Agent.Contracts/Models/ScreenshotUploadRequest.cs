namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record ScreenshotUploadRequest
{
    public string DeviceId { get; init; } = string.Empty;

    public string PolicyVersion { get; init; } = string.Empty;

    public DateTimeOffset CapturedAtUtc { get; init; } = DateTimeOffset.UtcNow;

    public string DisplayName { get; init; } = string.Empty;

    public ForegroundWindowInfo? ForegroundWindow { get; init; }

    public InputActivitySnapshot? InputActivity { get; init; }

    public SessionStateSnapshot? SessionState { get; init; }

    public string ImageFormat { get; init; } = "image/png";

    public byte[] ImageBytes { get; init; } = Array.Empty<byte>();

    public byte[] ThumbnailBytes { get; init; } = Array.Empty<byte>();
}
