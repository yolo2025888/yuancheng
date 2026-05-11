using System.Text.Json;
using Microsoft.Extensions.Options;
using EmployeeBehavior.Agent.Service.Configuration;

namespace EmployeeBehavior.Agent.Service.Infrastructure;

public sealed class FileDeviceIdentityStore : IDeviceIdentityStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly ILogger<FileDeviceIdentityStore> _logger;
    private readonly AgentServiceOptions _options;

    public FileDeviceIdentityStore(
        IOptions<AgentServiceOptions> options,
        ILogger<FileDeviceIdentityStore> logger)
    {
        _logger = logger;
        _options = options.Value;
    }

    public async ValueTask<string> GetOrCreateAsync(CancellationToken cancellationToken)
    {
        var path = _options.DeviceIdPath;
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            LocalFileProtection.EnsureProtectedDirectory(directory);
        }

        if (File.Exists(path))
        {
            LocalFileProtection.ProtectFileOrThrow(path, "Device identity");
            await using var readStream = File.OpenRead(path);
            var document = await JsonSerializer.DeserializeAsync<DeviceIdentityDocument>(
                readStream,
                SerializerOptions,
                cancellationToken);

            if (document is not null && !string.IsNullOrWhiteSpace(document.DeviceId))
            {
                return document.DeviceId;
            }
        }

        var created = new DeviceIdentityDocument(Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow);
        await using (File.Create(path))
        {
        }

        LocalFileProtection.ProtectFileOrThrow(path, "Device identity");
        await using (var writeStream = new FileStream(
                         path,
                         FileMode.Truncate,
                         FileAccess.Write,
                         FileShare.None,
                         bufferSize: 4096,
                         useAsync: true))
        {
            await JsonSerializer.SerializeAsync(writeStream, created, SerializerOptions, cancellationToken);
        }

        _logger.LogInformation("Created device identity file at {Path}.", path);
        return created.DeviceId;
    }
}
