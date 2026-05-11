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
            Directory.CreateDirectory(directory);
        }

        if (File.Exists(path))
        {
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
        await using var writeStream = File.Create(path);
        await JsonSerializer.SerializeAsync(writeStream, created, SerializerOptions, cancellationToken);
        _logger.LogInformation("Created device identity file at {Path}.", path);
        return created.DeviceId;
    }
}
