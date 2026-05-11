using System.Reflection;
using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.Service.Configuration;
using EmployeeBehavior.Agent.Service.Infrastructure;
using EmployeeBehavior.Agent.Service.Policy;
using EmployeeBehavior.Agent.Service.Session;
using EmployeeBehavior.Agent.Service.Transport;
using EmployeeBehavior.Agent.Service.Uploads;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.Service.Hosting;

public sealed class AgentWorker : BackgroundService
{
    private readonly IAgentApiClient _agentApiClient;
    private readonly IDeviceIdentityStore _deviceIdentityStore;
    private readonly ILogger<AgentWorker> _logger;
    private readonly AgentServiceOptions _options;
    private readonly IPolicyCache _policyCache;
    private readonly ISessionHelperClient _sessionHelperClient;
    private readonly IUploadQueue _uploadQueue;

    public AgentWorker(
        IAgentApiClient agentApiClient,
        IDeviceIdentityStore deviceIdentityStore,
        IOptions<AgentServiceOptions> options,
        IPolicyCache policyCache,
        ISessionHelperClient sessionHelperClient,
        IUploadQueue uploadQueue,
        ILogger<AgentWorker> logger)
    {
        _agentApiClient = agentApiClient;
        _deviceIdentityStore = deviceIdentityStore;
        _logger = logger;
        _options = options.Value;
        _policyCache = policyCache;
        _sessionHelperClient = sessionHelperClient;
        _uploadQueue = uploadQueue;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var deviceId = await _deviceIdentityStore.GetOrCreateAsync(stoppingToken);
        _logger.LogInformation("Agent service started for device {DeviceId}.", deviceId);

        try
        {
            await Task.WhenAll(
                RunHeartbeatLoopAsync(deviceId, stoppingToken),
                RunPolicyLoopAsync(stoppingToken),
                RunCaptureLoopAsync(deviceId, stoppingToken),
                RunUploadLoopAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Agent service stopping.");
        }
    }

    private async Task RunHeartbeatLoopAsync(string deviceId, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_options.HeartbeatIntervalSeconds));

        do
        {
            var snapshot = await _sessionHelperClient.CaptureSnapshotAsync(cancellationToken);
            var policy = _policyCache.Current;

            var request = new HeartbeatRequest
            {
                DeviceId = deviceId,
                AgentVersion = GetAgentVersion(),
                SentAtUtc = DateTimeOffset.UtcNow,
                CurrentPolicyVersion = policy.Version,
                SessionState = snapshot?.SessionState,
                ForegroundWindow = snapshot?.ForegroundWindow,
                InputActivity = snapshot?.InputActivity
            };

            var response = await _agentApiClient.SendHeartbeatAsync(request, cancellationToken);
            _logger.LogInformation(
                "Heartbeat sent for device {DeviceId}. Server policy version: {PolicyVersion}.",
                deviceId,
                response.PolicyVersion);
        }
        while (await timer.WaitForNextTickAsync(cancellationToken));
    }

    private async Task RunPolicyLoopAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_options.PolicyRefreshIntervalSeconds));

        do
        {
            var latestPolicy = await _agentApiClient.GetPolicyAsync(cancellationToken);
            _policyCache.Update(latestPolicy);

            _logger.LogInformation(
                "Policy refreshed. Version={Version}, ScreenshotInterval={Interval}s.",
                latestPolicy.Version,
                latestPolicy.ScreenshotIntervalSeconds);
        }
        while (await timer.WaitForNextTickAsync(cancellationToken));
    }

    private async Task RunCaptureLoopAsync(string deviceId, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var policy = _policyCache.Current;
            var delay = TimeSpan.FromSeconds(Math.Max(1, policy.ScreenshotIntervalSeconds));

            if (policy.CaptureEnabled)
            {
                var snapshot = await _sessionHelperClient.CaptureSnapshotAsync(cancellationToken);
                if (snapshot is not null)
                {
                    foreach (var upload in BuildUploads(deviceId, policy.Version, snapshot))
                    {
                        await _uploadQueue.EnqueueAsync(upload, cancellationToken);
                    }

                    _logger.LogDebug(
                        "Captured snapshot at {CapturedAtUtc} with {ScreenCount} screens.",
                        snapshot.CapturedAtUtc,
                        snapshot.Screens.Count);
                }
                else
                {
                    _logger.LogDebug("Session Helper snapshot not available. Capture skipped.");
                }
            }

            await Task.Delay(delay, cancellationToken);
        }
    }

    private async Task RunUploadLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var batch = await _uploadQueue.DequeueBatchAsync(_options.UploadBatchSize, cancellationToken);
            if (batch.Count == 0)
            {
                await Task.Delay(TimeSpan.FromSeconds(_options.UploadPollIntervalSeconds), cancellationToken);
                continue;
            }

            foreach (var item in batch)
            {
                var response = await _agentApiClient.UploadScreenshotAsync(item.Request, cancellationToken);
                await _agentApiClient.CompleteScreenshotAsync(
                    new ScreenshotUploadCompleteRequest
                    {
                        DeviceId = item.Request.DeviceId,
                        ScreenshotId = response.ScreenshotId,
                        CompletedAtUtc = DateTimeOffset.UtcNow
                    },
                    cancellationToken);

                _logger.LogInformation(
                    "Uploaded screenshot {ScreenshotId} for display {DisplayName}.",
                    response.ScreenshotId,
                    item.Request.DisplayName);
            }
        }
    }

    private static string GetAgentVersion()
    {
        return Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.1.0";
    }

    private static IEnumerable<QueuedUploadItem> BuildUploads(
        string deviceId,
        string policyVersion,
        SessionCaptureEnvelope snapshot)
    {
        foreach (var screen in snapshot.Screens)
        {
            yield return new QueuedUploadItem(
                Guid.NewGuid(),
                new ScreenshotUploadRequest
                {
                    DeviceId = deviceId,
                    PolicyVersion = policyVersion,
                    CapturedAtUtc = snapshot.CapturedAtUtc,
                    DisplayName = screen.DisplayName,
                    ForegroundWindow = snapshot.ForegroundWindow,
                    InputActivity = snapshot.InputActivity,
                    SessionState = snapshot.SessionState,
                    ImageFormat = screen.ImageFormat,
                    ImageBytes = screen.ImageBytes,
                    ThumbnailBytes = screen.ThumbnailBytes
                });
        }
    }
}
