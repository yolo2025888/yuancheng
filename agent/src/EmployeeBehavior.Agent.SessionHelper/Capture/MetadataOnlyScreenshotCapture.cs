using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.Capture;

public sealed class MetadataOnlyScreenshotCapture : IScreenshotCapture
{
    private readonly ILogger<MetadataOnlyScreenshotCapture> _logger;

    public MetadataOnlyScreenshotCapture(ILogger<MetadataOnlyScreenshotCapture> logger)
    {
        _logger = logger;
    }

    public Task<IReadOnlyList<CapturedScreen>> CaptureAsync(CancellationToken cancellationToken)
    {
        var screens = Screen.AllScreens
            .Select(screen => new CapturedScreen
            {
                DisplayName = screen.DeviceName,
                BoundsX = screen.Bounds.X,
                BoundsY = screen.Bounds.Y,
                Width = screen.Bounds.Width,
                Height = screen.Bounds.Height,
                ImageFormat = "image/png",
                ImageBytes = Array.Empty<byte>(),
                ThumbnailBytes = Array.Empty<byte>()
            })
            .ToArray();

        // TODO: Replace metadata-only payloads with real bitmap capture and thumbnail generation.
        _logger.LogDebug("Collected metadata for {ScreenCount} screen(s).", screens.Length);
        return Task.FromResult<IReadOnlyList<CapturedScreen>>(screens);
    }
}
