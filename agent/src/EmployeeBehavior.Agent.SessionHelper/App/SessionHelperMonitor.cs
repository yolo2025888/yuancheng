using Microsoft.Extensions.Options;
using EmployeeBehavior.Agent.SessionHelper.Configuration;

namespace EmployeeBehavior.Agent.SessionHelper.App;

public sealed class SessionHelperMonitor : BackgroundService
{
    private readonly ILogger<SessionHelperMonitor> _logger;
    private readonly ISessionSnapshotCollector _sessionSnapshotCollector;
    private readonly SessionHelperOptions _options;

    public SessionHelperMonitor(
        ISessionSnapshotCollector sessionSnapshotCollector,
        IOptions<SessionHelperOptions> options,
        ILogger<SessionHelperMonitor> logger)
    {
        _sessionSnapshotCollector = sessionSnapshotCollector;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_options.SampleLogIntervalSeconds));

        do
        {
            var snapshot = await _sessionSnapshotCollector.CaptureAsync(stoppingToken);
            _logger.LogInformation(
                "Session snapshot collected. Foreground={ForegroundWindow}; Keyboard={KeyboardCount}; Mouse={MouseCount}; Remote={IsRemote}.",
                snapshot.ForegroundWindow?.WindowTitle,
                snapshot.InputActivity?.KeyboardEventCount,
                snapshot.InputActivity?.MouseEventCount,
                snapshot.SessionState?.IsRemoteSession);
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
