namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record CapturedScreen
{
    public string DisplayName { get; init; } = string.Empty;

    public int BoundsX { get; init; }

    public int BoundsY { get; init; }

    public int Width { get; init; }

    public int Height { get; init; }

    public string ImageFormat { get; init; } = "image/png";

    public byte[] ImageBytes { get; init; } = Array.Empty<byte>();

    public byte[] ThumbnailBytes { get; init; } = Array.Empty<byte>();
}
