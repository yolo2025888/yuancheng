using System.Text.Json;
using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.Service.Configuration;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.Service.Infrastructure;

public interface IWorkSessionStateStore
{
    ValueTask<WorkSessionState> GetCurrentAsync(CancellationToken cancellationToken);
}

public sealed class FileWorkSessionStateStore : IWorkSessionStateStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly ILogger<FileWorkSessionStateStore> _logger;
    private readonly string _path;

    public FileWorkSessionStateStore(
        IOptions<AgentServiceOptions> options,
        ILogger<FileWorkSessionStateStore> logger)
    {
        _logger = logger;
        _path = options.Value.WorkSessionStatePath;
    }

    public async ValueTask<WorkSessionState> GetCurrentAsync(CancellationToken cancellationToken)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(_path) || !File.Exists(_path))
            {
                return WorkSessionState.Inactive();
            }

            await using var stream = new FileStream(
                _path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);
            var state = await JsonSerializer.DeserializeAsync<WorkSessionState>(
                stream,
                SerializerOptions,
                cancellationToken);

            return state ?? WorkSessionState.Inactive();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or NotSupportedException)
        {
            _logger.LogWarning(ex, "Failed to load work session state from {Path}. Monitoring will stay paused.", _path);
            return WorkSessionState.Inactive();
        }
    }
}
