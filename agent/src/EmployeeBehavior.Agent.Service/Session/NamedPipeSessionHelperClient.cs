using EmployeeBehavior.Agent.Contracts.Models;
using Microsoft.Extensions.Options;
using EmployeeBehavior.Agent.Service.Configuration;

namespace EmployeeBehavior.Agent.Service.Session;

public sealed class NamedPipeSessionHelperClient : ISessionHelperClient
{
    private readonly ILogger<NamedPipeSessionHelperClient> _logger;
    private readonly AgentServiceOptions _options;

    public NamedPipeSessionHelperClient(
        IOptions<AgentServiceOptions> options,
        ILogger<NamedPipeSessionHelperClient> logger)
    {
        _logger = logger;
        _options = options.Value;
    }

    public Task<SessionCaptureEnvelope?> CaptureSnapshotAsync(CancellationToken cancellationToken)
    {
        _logger.LogDebug(
            "Session Helper IPC placeholder invoked for pipe {PipeName}.",
            _options.SessionHelperPipeName);

        // TODO: Replace with Named Pipe request/response exchange to the Session Helper process.
        return Task.FromResult<SessionCaptureEnvelope?>(null);
    }
}
