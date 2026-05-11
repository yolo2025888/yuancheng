using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using EmployeeBehavior.Agent.Contracts.Models;
using Microsoft.Extensions.Options;
using EmployeeBehavior.Agent.Service.Configuration;

namespace EmployeeBehavior.Agent.Service.Session;

public sealed class NamedPipeSessionHelperClient : ISessionHelperClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly ILogger<NamedPipeSessionHelperClient> _logger;
    private readonly AgentServiceOptions _options;

    public NamedPipeSessionHelperClient(
        IOptions<AgentServiceOptions> options,
        ILogger<NamedPipeSessionHelperClient> logger)
    {
        _logger = logger;
        _options = options.Value;
    }

    public async Task<SessionCaptureEnvelope?> CaptureSnapshotAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var pipe = new NamedPipeClientStream(
                ".",
                _options.SessionHelperPipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous);

            await pipe.ConnectAsync(
                Math.Max(1, _options.SessionHelperConnectTimeoutSeconds) * 1000,
                cancellationToken);

            using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
            await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
            {
                AutoFlush = true
            };

            var requestJson = JsonSerializer.Serialize(new SessionHelperRequest(), JsonOptions);
            await writer.WriteLineAsync(requestJson);

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, _options.SessionHelperRequestTimeoutSeconds)));

            var responseLine = await reader.ReadLineAsync().WaitAsync(timeoutCts.Token);
            if (string.IsNullOrWhiteSpace(responseLine))
            {
                _logger.LogWarning("Session Helper pipe {PipeName} returned an empty response.", _options.SessionHelperPipeName);
                return null;
            }

            var response = JsonSerializer.Deserialize<SessionHelperResponse>(responseLine, JsonOptions);
            if (response?.Success == true)
            {
                return response.Snapshot;
            }

            _logger.LogWarning(
                "Session Helper pipe {PipeName} responded with an error: {Error}.",
                _options.SessionHelperPipeName,
                response?.Error ?? "unknown error");
            return null;
        }
        catch (TimeoutException ex)
        {
            _logger.LogWarning(ex, "Timed out connecting to Session Helper pipe {PipeName}.", _options.SessionHelperPipeName);
            return null;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(
                "Session Helper request on pipe {PipeName} timed out after {TimeoutSeconds}s.",
                _options.SessionHelperPipeName,
                _options.SessionHelperRequestTimeoutSeconds);
            return null;
        }
        catch (IOException ex)
        {
            _logger.LogWarning(ex, "Unable to capture a session snapshot from pipe {PipeName}.", _options.SessionHelperPipeName);
            return null;
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Received invalid JSON from Session Helper pipe {PipeName}.", _options.SessionHelperPipeName);
            return null;
        }
    }
}
