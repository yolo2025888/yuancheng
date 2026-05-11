using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Security.Cryptography;
using EmployeeBehavior.Agent.Contracts.Models;
using Microsoft.Extensions.Logging;
using System.Windows.Forms;

namespace EmployeeBehavior.Agent.SessionHelper.Capture;

public sealed class WindowsScreenshotCapture : IScreenshotCapture
{
    private const int ThumbnailMaxEdge = 320;
    private readonly ILogger<WindowsScreenshotCapture> _logger;

    public WindowsScreenshotCapture(ILogger<WindowsScreenshotCapture> logger)
    {
        _logger = logger;
    }

    public Task<IReadOnlyList<CapturedScreen>> CaptureAsync(CancellationToken cancellationToken)
    {
        var screens = new List<CapturedScreen>();

        var screenIndex = 0;
        foreach (var screen in Screen.AllScreens)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                using var bitmap = new Bitmap(screen.Bounds.Width, screen.Bounds.Height, PixelFormat.Format32bppArgb);
                using (var graphics = Graphics.FromImage(bitmap))
                {
                    graphics.CopyFromScreen(
                        screen.Bounds.X,
                        screen.Bounds.Y,
                        0,
                        0,
                        screen.Bounds.Size,
                        CopyPixelOperation.SourceCopy);
                }

                var imageBytes = Encode(bitmap, ImageFormat.Png);
                using var thumbnail = CreateThumbnail(bitmap, ThumbnailMaxEdge);
                var thumbnailBytes = Encode(thumbnail, ImageFormat.Jpeg);

                screens.Add(new CapturedScreen
                {
                    ScreenIndex = screenIndex,
                    DisplayName = screen.DeviceName,
                    BoundsX = screen.Bounds.X,
                    BoundsY = screen.Bounds.Y,
                    Width = screen.Bounds.Width,
                    Height = screen.Bounds.Height,
                    ImageFormat = "image/png",
                    ImageBytes = imageBytes,
                    ImageSha256 = ComputeSha256(imageBytes),
                    ImageSizeBytes = imageBytes.LongLength,
                    ImageWidth = bitmap.Width,
                    ImageHeight = bitmap.Height,
                    ThumbnailFormat = "image/jpeg",
                    ThumbnailBytes = thumbnailBytes,
                    ThumbnailSha256 = ComputeSha256(thumbnailBytes),
                    ThumbnailSizeBytes = thumbnailBytes.LongLength,
                    ThumbnailWidth = thumbnail.Width,
                    ThumbnailHeight = thumbnail.Height
                });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to capture display {DisplayName}.", screen.DeviceName);
            }

            screenIndex++;
        }

        _logger.LogDebug("Captured {ScreenCount} screen(s) with image payloads.", screens.Count);
        return Task.FromResult<IReadOnlyList<CapturedScreen>>(screens);
    }

    private static Bitmap CreateThumbnail(Image source, int maxEdge)
    {
        if (source.Width <= 0 || source.Height <= 0)
        {
            throw new InvalidOperationException("Cannot generate a thumbnail for an empty image.");
        }

        var scale = Math.Min(1d, maxEdge / (double)Math.Max(source.Width, source.Height));
        var thumbnailWidth = Math.Max(1, (int)Math.Round(source.Width * scale));
        var thumbnailHeight = Math.Max(1, (int)Math.Round(source.Height * scale));

        var thumbnail = new Bitmap(thumbnailWidth, thumbnailHeight, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(thumbnail);
        graphics.Clear(Color.Black);
        graphics.CompositingQuality = CompositingQuality.HighQuality;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.SmoothingMode = SmoothingMode.HighQuality;
        graphics.DrawImage(source, 0, 0, thumbnailWidth, thumbnailHeight);
        return thumbnail;
    }

    private static byte[] Encode(Image image, ImageFormat format)
    {
        using var stream = new MemoryStream();
        image.Save(stream, format);
        return stream.ToArray();
    }

    private static string ComputeSha256(byte[] payload)
    {
        return Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
    }
}
