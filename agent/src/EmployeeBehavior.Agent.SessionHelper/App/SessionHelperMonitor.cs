using Microsoft.Extensions.Options;
using EmployeeBehavior.Agent.SessionHelper.Configuration;
using EmployeeBehavior.Agent.SessionHelper.Monitoring;

namespace EmployeeBehavior.Agent.SessionHelper.App;

public sealed class SessionHelperMonitor : BackgroundService
{
    private readonly IForegroundWindowProvider _foregroundWindowProvider;
    private readonly ILogger<SessionHelperMonitor> _logger;
    private readonly SessionHelperOptions _options;
    private readonly ISessionStateProvider _sessionStateProvider;

    public SessionHelperMonitor(
        IForegroundWindowProvider foregroundWindowProvider,
        ISessionStateProvider sessionStateProvider,
        IOptions<SessionHelperOptions> options,
        ILogger<SessionHelperMonitor> logger)
    {
        _foregroundWindowProvider = foregroundWindowProvider;
        _sessionStateProvider = sessionStateProvider;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_options.SampleLogIntervalSeconds));

        do
        {
            var foregroundWindowTask = _foregroundWindowProvider.GetCurrentAsync(stoppingToken);
            var sessionStateTask = _sessionStateProvider.GetCurrentAsync(stoppingToken);
            await Task.WhenAll(foregroundWindowTask, sessionStateTask);

            var foregroundWindow = await foregroundWindowTask;
            var sessionState = await sessionStateTask;
            _logger.LogInformation(
                "Session helper alive. Foreground={ForegroundWindow}; Remote={IsRemote}; Locked={IsLocked}; Idle={IdleSeconds}s; Desktop={DesktopName}.",
                foregroundWindow.WindowTitle,
                sessionState.IsRemoteSession,
                sessionState.IsLocked,
                sessionState.IdleSeconds,
                sessionState.InputDesktopName);
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
