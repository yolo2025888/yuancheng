using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.SessionHelper.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.SessionHelper.App;

public sealed class NamedPipeSessionServer : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly ILogger<NamedPipeSessionServer> _logger;
    private readonly SessionHelperOptions _options;
    private readonly ISessionSnapshotCollector _sessionSnapshotCollector;

    public NamedPipeSessionServer(
        ISessionSnapshotCollector sessionSnapshotCollector,
        IOptions<SessionHelperOptions> options,
        ILogger<NamedPipeSessionServer> logger)
    {
        _sessionSnapshotCollector = sessionSnapshotCollector;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await using var server = CreateServerStream(_options.PipeName);

            try
            {
                await server.WaitForConnectionAsync(stoppingToken);
                await HandleRequestAsync(server, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Session Helper pipe server loop failed for pipe {PipeName}.", _options.PipeName);
            }
        }
    }

    private static NamedPipeServerStream CreateServerStream(string pipeName)
    {
        return NamedPipeServerStreamAcl.Create(
            pipeName,
            PipeDirection.InOut,
            maxNumberOfServerInstances: 1,
            transmissionMode: PipeTransmissionMode.Byte,
            options: PipeOptions.Asynchronous,
            inBufferSize: 0,
            outBufferSize: 0,
            pipeSecurity: CreatePipeSecurity());
    }

    private static PipeSecurity CreatePipeSecurity()
    {
        var pipeSecurity = new PipeSecurity();
        AddPipeAccessRule(pipeSecurity, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null));
        AddPipeAccessRule(pipeSecurity, new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        return pipeSecurity;
    }

    private static void AddPipeAccessRule(PipeSecurity pipeSecurity, SecurityIdentifier identity)
    {
        pipeSecurity.AddAccessRule(
            new PipeAccessRule(
                identity,
                PipeAccessRights.FullControl,
                AccessControlType.Allow));
    }

    private async Task HandleRequestAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
        await using var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true)
        {
            AutoFlush = true
        };

        var requestLine = await reader.ReadLineAsync().WaitAsync(cancellationToken);
        var response = await BuildResponseAsync(requestLine, cancellationToken);

        var responseJson = JsonSerializer.Serialize(response, JsonOptions);
        await writer.WriteLineAsync(responseJson);
    }

    private async Task<SessionHelperResponse> BuildResponseAsync(string? requestLine, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(requestLine))
        {
            return new SessionHelperResponse
            {
                Error = "Empty request payload."
            };
        }

        SessionHelperRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<SessionHelperRequest>(requestLine, JsonOptions);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Invalid Session Helper request payload.");
            return new SessionHelperResponse
            {
                Error = "Invalid request payload."
            };
        }

        if (!string.Equals(request?.Command, SessionHelperRequest.CaptureSnapshotCommand, StringComparison.OrdinalIgnoreCase))
        {
            return new SessionHelperResponse
            {
                Error = $"Unsupported command '{request?.Command ?? "<null>"}'."
            };
        }

        var snapshot = await _sessionSnapshotCollector.CaptureAsync(cancellationToken);
        return new SessionHelperResponse
        {
            Success = true,
            Snapshot = snapshot
        };
    }
}
