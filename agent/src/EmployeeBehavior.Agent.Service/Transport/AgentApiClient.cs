using System.Net.Http.Json;
using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.Service.Configuration;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.Service.Transport;

public sealed class AgentApiClient : IAgentApiClient
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<AgentApiClient> _logger;
    private readonly AgentServiceOptions _options;

    public AgentApiClient(
        HttpClient httpClient,
        IOptions<AgentServiceOptions> options,
        ILogger<AgentApiClient> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _options = options.Value;
    }

    public async Task<HeartbeatResponse> SendHeartbeatAsync(
        HeartbeatRequest request,
        CancellationToken cancellationToken)
    {
        if (_options.DryRun)
        {
            _logger.LogInformation("DryRun heartbeat to /api/agent/heartbeat for device {DeviceId}.", request.DeviceId);
            return new HeartbeatResponse
            {
                PolicyVersion = request.CurrentPolicyVersion,
                ServerTimeUtc = DateTimeOffset.UtcNow,
                NextHeartbeatInSeconds = _options.HeartbeatIntervalSeconds
            };
        }

        using var response = await _httpClient.PostAsJsonAsync(
            "/api/agent/heartbeat",
            request,
            cancellationToken);

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<HeartbeatResponse>(cancellationToken: cancellationToken)
            ?? new HeartbeatResponse();
    }

    public async Task<AgentPolicy> GetPolicyAsync(CancellationToken cancellationToken)
    {
        if (_options.DryRun)
        {
            _logger.LogInformation("DryRun policy fetch from /api/agent/policy.");
            return _options.DefaultPolicy ?? AgentPolicy.CreateDefault();
        }

        return await _httpClient.GetFromJsonAsync<AgentPolicy>(
                   "/api/agent/policy",
                   cancellationToken)
               ?? AgentPolicy.CreateDefault();
    }

    public async Task<ScreenshotUploadResponse> UploadScreenshotAsync(
        ScreenshotUploadRequest request,
        CancellationToken cancellationToken)
    {
        if (_options.DryRun)
        {
            _logger.LogInformation(
                "DryRun screenshot upload to /api/agent/screenshots for display {DisplayName}.",
                request.DisplayName);

            return new ScreenshotUploadResponse
            {
                ScreenshotId = Guid.NewGuid().ToString("N"),
                Status = "accepted"
            };
        }

        using var response = await _httpClient.PostAsJsonAsync(
            "/api/agent/screenshots",
            request,
            cancellationToken);

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<ScreenshotUploadResponse>(cancellationToken: cancellationToken)
            ?? new ScreenshotUploadResponse();
    }

    public async Task CompleteScreenshotAsync(
        ScreenshotUploadCompleteRequest request,
        CancellationToken cancellationToken)
    {
        if (_options.DryRun)
        {
            _logger.LogInformation(
                "DryRun screenshot completion to /api/agent/screenshots/{ScreenshotId}/complete.",
                request.ScreenshotId);
            return;
        }

        using var response = await _httpClient.PostAsJsonAsync(
            $"/api/agent/screenshots/{request.ScreenshotId}/complete",
            request,
            cancellationToken);

        response.EnsureSuccessStatusCode();
    }
}
