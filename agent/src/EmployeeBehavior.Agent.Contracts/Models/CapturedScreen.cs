namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record CapturedScreen
{
    public int ScreenIndex { get; init; }

    public string DisplayName { get; init; } = string.Empty;

    public int BoundsX { get; init; }

    public int BoundsY { get; init; }

    public int Width { get; init; }

    public int Height { get; init; }

    public string ImageFormat { get; init; } = "image/png";

    public byte[] ImageBytes { get; init; } = Array.Empty<byte>();

    public string? ImageTempFilePath { get; init; }

    public bool DeleteImageTempFileOnRead { get; init; }

    public string ImageSha256 { get; init; } = string.Empty;

    public long ImageSizeBytes { get; init; }

    public int ImageWidth { get; init; }

    public int ImageHeight { get; init; }

    public string ThumbnailFormat { get; init; } = "image/jpeg";

    public byte[] ThumbnailBytes { get; init; } = Array.Empty<byte>();

    public string? ThumbnailTempFilePath { get; init; }

    public bool DeleteThumbnailTempFileOnRead { get; init; }

    public string ThumbnailSha256 { get; init; } = string.Empty;

    public long ThumbnailSizeBytes { get; init; }

    public int ThumbnailWidth { get; init; }

    public int ThumbnailHeight { get; init; }
}
