using System.Text;
using System.Text.Json;
using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.Service.Configuration;
using EmployeeBehavior.Agent.Service.Infrastructure;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.Service.Uploads;

public sealed class FileBackedUploadQueue : IUploadQueue
{
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly TimeSpan _leaseDuration;
    private readonly ILogger<FileBackedUploadQueue> _logger;
    private readonly string _payloadDirectory;
    private readonly string _queuePath;

    public FileBackedUploadQueue(
        IOptions<AgentServiceOptions> options,
        ILogger<FileBackedUploadQueue> logger)
    {
        _logger = logger;

        var resolvedOptions = options.Value;
        _queuePath = resolvedOptions.UploadQueuePath;
        _payloadDirectory = ResolvePayloadDirectory(_queuePath);
        _leaseDuration = TimeSpan.FromSeconds(Math.Max(30, resolvedOptions.UploadQueueLeaseDurationSeconds));
    }

    public async ValueTask EnqueueAsync(QueuedUploadItem item, CancellationToken cancellationToken)
    {
        var createdPayloadPaths = new List<string>();
        var sourcePayloadCleanupPaths = new List<string>();

        await _gate.WaitAsync(cancellationToken);
        try
        {
            EnsureQueueDirectory();
            var queuedRequest = await PrepareRequestForQueueAsync(
                item.LocalId,
                item.Request,
                createdPayloadPaths,
                sourcePayloadCleanupPaths,
                cancellationToken);
            var entry = PersistentUploadQueueEntry.FromQueuedRequest(item.LocalId, queuedRequest);

            EnsureProtectedQueueFile();
            await using (var stream = new FileStream(
                             _queuePath,
                             FileMode.Append,
                             FileAccess.Write,
                             FileShare.Read,
                             bufferSize: 4096,
                             useAsync: true))
            await using (var writer = new StreamWriter(stream, Utf8NoBom))
            {
                var serialized = JsonSerializer.Serialize(entry, SerializerOptions);
                await writer.WriteLineAsync(serialized.AsMemory(), cancellationToken);
                await writer.FlushAsync(cancellationToken);
            }

            DeleteFilesBestEffort(sourcePayloadCleanupPaths);
        }
        catch
        {
            DeleteFilesBestEffort(createdPayloadPaths);
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask<UploadQueueLease> LeaseBatchAsync(int maxItems, CancellationToken cancellationToken)
    {
        if (maxItems <= 0)
        {
            return UploadQueueLease.Empty;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var entries = await LoadEntriesAsync(cancellationToken);
            if (entries.Count == 0)
            {
                return UploadQueueLease.Empty;
            }

            var now = DateTimeOffset.UtcNow;
            var leaseId = Guid.NewGuid().ToString("N");
            var leasedItems = new List<QueuedUploadItem>(Math.Max(1, maxItems));

            foreach (var entry in entries)
            {
                if (leasedItems.Count >= maxItems)
                {
                    break;
                }

                if (!entry.IsLeaseAvailable(now))
                {
                    continue;
                }

                entry.LeaseId = leaseId;
                entry.LeasedUntilUtc = now.Add(_leaseDuration);
                entry.AttemptCount++;
                leasedItems.Add(entry.ToQueuedUploadItem());
            }

            if (leasedItems.Count == 0)
            {
                return UploadQueueLease.Empty;
            }

            await SaveEntriesAsync(entries, cancellationToken);

            _logger.LogDebug(
                "Leased {Count} upload item(s) from {QueuePath} with lease {LeaseId}.",
                leasedItems.Count,
                _queuePath,
                leaseId);

            return new UploadQueueLease(leaseId, leasedItems);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask CompleteAsync(
        string leaseId,
        IReadOnlyCollection<Guid> localIds,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(leaseId) || localIds.Count == 0)
        {
            return;
        }

        var localIdSet = localIds.ToHashSet();

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var entries = await LoadEntriesAsync(cancellationToken);
            var removedCount = entries.RemoveAll(entry =>
                string.Equals(entry.LeaseId, leaseId, StringComparison.Ordinal) &&
                localIdSet.Contains(entry.LocalId));

            if (removedCount > 0)
            {
                await SaveEntriesAsync(entries, cancellationToken);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask ReleaseAsync(
        string leaseId,
        IReadOnlyCollection<Guid> localIds,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(leaseId) || localIds.Count == 0)
        {
            return;
        }

        var localIdSet = localIds.ToHashSet();

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var entries = await LoadEntriesAsync(cancellationToken);
            var changed = false;

            foreach (var entry in entries)
            {
                if (!string.Equals(entry.LeaseId, leaseId, StringComparison.Ordinal) ||
                    !localIdSet.Contains(entry.LocalId))
                {
                    continue;
                }

                entry.LeaseId = null;
                entry.LeasedUntilUtc = null;
                changed = true;
            }

            if (changed)
            {
                await SaveEntriesAsync(entries, cancellationToken);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private void EnsureQueueDirectory()
    {
        var directory = Path.GetDirectoryName(_queuePath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            LocalFileProtection.EnsureProtectedDirectory(directory);
        }
    }

    private static string ResolvePayloadDirectory(string queuePath)
    {
        var directory = Path.GetDirectoryName(queuePath);
        var queueName = Path.GetFileNameWithoutExtension(queuePath);
        var payloadDirectoryName = string.IsNullOrWhiteSpace(queueName)
            ? "upload-queue-payloads"
            : $"{queueName}-payloads";

        return string.IsNullOrWhiteSpace(directory)
            ? payloadDirectoryName
            : Path.Combine(directory, payloadDirectoryName);
    }

    private async Task<ScreenshotUploadRequest> PrepareRequestForQueueAsync(
        Guid localId,
        ScreenshotUploadRequest request,
        ICollection<string> createdPayloadPaths,
        ICollection<string> sourcePayloadCleanupPaths,
        CancellationToken cancellationToken)
    {
        var queuedRequest = request;

        if (request.ImageBytes.Length > 0)
        {
            var imagePath = await WriteProtectedPayloadFileAsync(
                localId,
                "image",
                request.ImageBytes,
                createdPayloadPaths,
                cancellationToken);
            queuedRequest = queuedRequest with
            {
                ImageBytes = Array.Empty<byte>(),
                ImageTempFilePath = imagePath,
                DeleteImageTempFileOnRead = true
            };
        }
        else if (!string.IsNullOrWhiteSpace(request.ImageTempFilePath) && File.Exists(request.ImageTempFilePath))
        {
            var imagePath = await CopyProtectedPayloadFileAsync(
                localId,
                "image",
                request.ImageTempFilePath,
                createdPayloadPaths,
                cancellationToken);
            if (request.DeleteImageTempFileOnRead)
            {
                sourcePayloadCleanupPaths.Add(request.ImageTempFilePath);
            }
            queuedRequest = queuedRequest with
            {
                ImageTempFilePath = imagePath,
                DeleteImageTempFileOnRead = true
            };
        }

        if (request.ThumbnailBytes.Length > 0)
        {
            var thumbnailPath = await WriteProtectedPayloadFileAsync(
                localId,
                "thumbnail",
                request.ThumbnailBytes,
                createdPayloadPaths,
                cancellationToken);
            queuedRequest = queuedRequest with
            {
                ThumbnailBytes = Array.Empty<byte>(),
                ThumbnailTempFilePath = thumbnailPath,
                DeleteThumbnailTempFileOnRead = true
            };
        }
        else if (!string.IsNullOrWhiteSpace(request.ThumbnailTempFilePath) && File.Exists(request.ThumbnailTempFilePath))
        {
            var thumbnailPath = await CopyProtectedPayloadFileAsync(
                localId,
                "thumbnail",
                request.ThumbnailTempFilePath,
                createdPayloadPaths,
                cancellationToken);
            if (request.DeleteThumbnailTempFileOnRead)
            {
                sourcePayloadCleanupPaths.Add(request.ThumbnailTempFilePath);
            }
            queuedRequest = queuedRequest with
            {
                ThumbnailTempFilePath = thumbnailPath,
                DeleteThumbnailTempFileOnRead = true
            };
        }

        return queuedRequest;
    }

    private async Task<string> WriteProtectedPayloadFileAsync(
        Guid localId,
        string payloadKind,
        byte[] payload,
        ICollection<string> createdPayloadPaths,
        CancellationToken cancellationToken)
    {
        LocalFileProtection.EnsureProtectedDirectory(_payloadDirectory);
        var payloadPath = Path.Combine(_payloadDirectory, $"{localId:N}-{payloadKind}.bin");

        await using (File.Create(payloadPath))
        {
        }

        createdPayloadPaths.Add(payloadPath);
        ProtectFileOrThrow(payloadPath);

        await using var stream = new FileStream(
            payloadPath,
            FileMode.Truncate,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 81920,
            useAsync: true);
        await stream.WriteAsync(payload.AsMemory(), cancellationToken);
        await stream.FlushAsync(cancellationToken);

        return payloadPath;
    }

    private async Task<string> CopyProtectedPayloadFileAsync(
        Guid localId,
        string payloadKind,
        string sourcePath,
        ICollection<string> createdPayloadPaths,
        CancellationToken cancellationToken)
    {
        LocalFileProtection.EnsureProtectedDirectory(_payloadDirectory);
        var payloadPath = Path.Combine(_payloadDirectory, $"{localId:N}-{payloadKind}.bin");

        await using (File.Create(payloadPath))
        {
        }

        createdPayloadPaths.Add(payloadPath);
        ProtectFileOrThrow(payloadPath);

        await using var source = new FileStream(
            sourcePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 81920,
            useAsync: true);
        await using var destination = new FileStream(
            payloadPath,
            FileMode.Truncate,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 81920,
            useAsync: true);
        await source.CopyToAsync(destination, cancellationToken);
        await destination.FlushAsync(cancellationToken);

        return payloadPath;
    }

    private async Task<List<PersistentUploadQueueEntry>> LoadEntriesAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_queuePath))
        {
            return new List<PersistentUploadQueueEntry>();
        }

        var lines = await File.ReadAllLinesAsync(_queuePath, cancellationToken);
        var entries = new List<PersistentUploadQueueEntry>(lines.Length);

        for (var lineIndex = 0; lineIndex < lines.Length; lineIndex++)
        {
            var line = lines[lineIndex];
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            PersistentUploadQueueEntry? entry;
            try
            {
                entry = JsonSerializer.Deserialize<PersistentUploadQueueEntry>(line, SerializerOptions);
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(
                    ex,
                    "Ignoring malformed upload queue entry at line {LineNumber} in {QueuePath}.",
                    lineIndex + 1,
                    _queuePath);
                continue;
            }

            if (entry is null)
            {
                _logger.LogWarning(
                    "Ignoring empty upload queue entry at line {LineNumber} in {QueuePath}.",
                    lineIndex + 1,
                    _queuePath);
                continue;
            }

            entries.Add(entry);
        }

        return entries;
    }

    private async Task SaveEntriesAsync(
        IReadOnlyCollection<PersistentUploadQueueEntry> entries,
        CancellationToken cancellationToken)
    {
        EnsureQueueDirectory();

        if (entries.Count == 0)
        {
            if (File.Exists(_queuePath))
            {
                File.Delete(_queuePath);
            }

            return;
        }

        var tempPath = $"{_queuePath}.{Guid.NewGuid():N}.tmp";

        await using (File.Create(tempPath))
        {
        }

        ProtectFileOrThrow(tempPath);

        await using (var stream = new FileStream(
                         tempPath,
                         FileMode.Truncate,
                         FileAccess.Write,
                         FileShare.None,
                         bufferSize: 4096,
                         useAsync: true))
        await using (var writer = new StreamWriter(stream, Utf8NoBom))
        {
            foreach (var entry in entries)
            {
                var serialized = JsonSerializer.Serialize(entry, SerializerOptions);
                await writer.WriteLineAsync(serialized.AsMemory(), cancellationToken);
            }

            await writer.FlushAsync(cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }

        if (File.Exists(_queuePath))
        {
            File.Replace(tempPath, _queuePath, destinationBackupFileName: null);
        }
        else
        {
            File.Move(tempPath, _queuePath);
        }
    }

    private void EnsureProtectedQueueFile()
    {
        if (!File.Exists(_queuePath))
        {
            using (File.Create(_queuePath))
            {
            }
        }

        ProtectFileOrThrow(_queuePath);
    }

    private void ProtectFileOrThrow(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("The agent upload queue requires Windows file encryption support.");
        }

        try
        {
            LocalFileProtection.ProtectFileOrThrow(path, "Upload queue");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException or InvalidOperationException)
        {
            throw new InvalidOperationException(
                $"Upload queue file '{path}' could not be protected by Windows EFS. Configure an encrypted local queue path or fix service permissions before live capture.",
                ex);
        }
    }

    private static void DeleteFilesBestEffort(IEnumerable<string> paths)
    {
        foreach (var path in paths)
        {
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch
            {
                // Enqueue failed; cleanup is best-effort because the original failure is more actionable.
            }
        }
    }

    private sealed class PersistentUploadQueueEntry
    {
        public Guid LocalId { get; init; }

        public PersistentScreenshotUploadRequest Request { get; init; } = new();

        public int AttemptCount { get; set; }

        public string? LeaseId { get; set; }

        public DateTimeOffset? LeasedUntilUtc { get; set; }

        public static PersistentUploadQueueEntry FromQueuedRequest(Guid localId, ScreenshotUploadRequest request)
        {
            return new PersistentUploadQueueEntry
            {
                LocalId = localId,
                Request = PersistentScreenshotUploadRequest.FromUploadRequest(request)
            };
        }

        public bool IsLeaseAvailable(DateTimeOffset now)
        {
            return string.IsNullOrWhiteSpace(LeaseId) ||
                   !LeasedUntilUtc.HasValue ||
                   LeasedUntilUtc.Value <= now;
        }

        public QueuedUploadItem ToQueuedUploadItem()
        {
            return new QueuedUploadItem(LocalId, Request.ToUploadRequest());
        }
    }

    private sealed class PersistentScreenshotUploadRequest
    {
        public string DeviceId { get; init; } = string.Empty;

        public string PolicyVersion { get; init; } = string.Empty;

        public DateTimeOffset CapturedAtUtc { get; init; } = DateTimeOffset.UtcNow;

        public string DisplayName { get; init; } = string.Empty;

        public int ScreenIndex { get; init; }

        public ForegroundWindowInfo? ForegroundWindow { get; init; }

        public InputActivitySnapshot? InputActivity { get; init; }

        public SessionStateSnapshot? SessionState { get; init; }

        public string ImageFormat { get; init; } = "image/png";

        public string? ImageTempFilePath { get; init; }

        public bool DeleteImageTempFileOnRead { get; init; }

        public string ImageSha256 { get; init; } = string.Empty;

        public long ImageSizeBytes { get; init; }

        public int ImageWidth { get; init; }

        public int ImageHeight { get; init; }

        public string ThumbnailFormat { get; init; } = "image/jpeg";

        public string? ThumbnailTempFilePath { get; init; }

        public bool DeleteThumbnailTempFileOnRead { get; init; }

        public string ThumbnailSha256 { get; init; } = string.Empty;

        public long ThumbnailSizeBytes { get; init; }

        public int ThumbnailWidth { get; init; }

        public int ThumbnailHeight { get; init; }

        public static PersistentScreenshotUploadRequest FromUploadRequest(ScreenshotUploadRequest request)
        {
            return new PersistentScreenshotUploadRequest
            {
                DeviceId = request.DeviceId,
                PolicyVersion = request.PolicyVersion,
                CapturedAtUtc = request.CapturedAtUtc,
                DisplayName = request.DisplayName,
                ScreenIndex = request.ScreenIndex,
                ForegroundWindow = request.ForegroundWindow,
                InputActivity = request.InputActivity,
                SessionState = request.SessionState,
                ImageFormat = request.ImageFormat,
                ImageTempFilePath = request.ImageTempFilePath,
                DeleteImageTempFileOnRead = request.DeleteImageTempFileOnRead,
                ImageSha256 = request.ImageSha256,
                ImageSizeBytes = request.ImageSizeBytes,
                ImageWidth = request.ImageWidth,
                ImageHeight = request.ImageHeight,
                ThumbnailFormat = request.ThumbnailFormat,
                ThumbnailTempFilePath = request.ThumbnailTempFilePath,
                DeleteThumbnailTempFileOnRead = request.DeleteThumbnailTempFileOnRead,
                ThumbnailSha256 = request.ThumbnailSha256,
                ThumbnailSizeBytes = request.ThumbnailSizeBytes,
                ThumbnailWidth = request.ThumbnailWidth,
                ThumbnailHeight = request.ThumbnailHeight
            };
        }

        public ScreenshotUploadRequest ToUploadRequest()
        {
            return new ScreenshotUploadRequest
            {
                DeviceId = DeviceId,
                PolicyVersion = PolicyVersion,
                CapturedAtUtc = CapturedAtUtc,
                DisplayName = DisplayName,
                ScreenIndex = ScreenIndex,
                ForegroundWindow = ForegroundWindow,
                InputActivity = InputActivity,
                SessionState = SessionState,
                ImageFormat = ImageFormat,
                ImageTempFilePath = ImageTempFilePath,
                DeleteImageTempFileOnRead = DeleteImageTempFileOnRead,
                ImageSha256 = ImageSha256,
                ImageSizeBytes = ImageSizeBytes,
                ImageWidth = ImageWidth,
                ImageHeight = ImageHeight,
                ThumbnailFormat = ThumbnailFormat,
                ThumbnailTempFilePath = ThumbnailTempFilePath,
                DeleteThumbnailTempFileOnRead = DeleteThumbnailTempFileOnRead,
                ThumbnailSha256 = ThumbnailSha256,
                ThumbnailSizeBytes = ThumbnailSizeBytes,
                ThumbnailWidth = ThumbnailWidth,
                ThumbnailHeight = ThumbnailHeight
            };
        }
    }
}
