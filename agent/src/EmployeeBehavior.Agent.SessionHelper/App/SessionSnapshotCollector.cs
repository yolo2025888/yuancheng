using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.SessionHelper.Capture;
using EmployeeBehavior.Agent.SessionHelper.Monitoring;

namespace EmployeeBehavior.Agent.SessionHelper.App;

public sealed class SessionSnapshotCollector : ISessionSnapshotCollector
{
    private readonly IForegroundWindowProvider _foregroundWindowProvider;
    private readonly IInputActivityCounter _inputActivityCounter;
    private readonly IScreenshotCapture _screenshotCapture;
    private readonly ISessionStateProvider _sessionStateProvider;

    public SessionSnapshotCollector(
        IScreenshotCapture screenshotCapture,
        IForegroundWindowProvider foregroundWindowProvider,
        IInputActivityCounter inputActivityCounter,
        ISessionStateProvider sessionStateProvider)
    {
        _screenshotCapture = screenshotCapture;
        _foregroundWindowProvider = foregroundWindowProvider;
        _inputActivityCounter = inputActivityCounter;
        _sessionStateProvider = sessionStateProvider;
    }

    public async Task<SessionCaptureEnvelope> CaptureAsync(CancellationToken cancellationToken)
    {
        var capturedAtUtc = DateTimeOffset.UtcNow;

        var screensTask = _screenshotCapture.CaptureAsync(cancellationToken);
        var foregroundWindowTask = _foregroundWindowProvider.GetCurrentAsync(cancellationToken);
        var inputActivityTask = _inputActivityCounter.GetSnapshotAsync(cancellationToken);
        var sessionStateTask = _sessionStateProvider.GetCurrentAsync(cancellationToken);

        await Task.WhenAll(screensTask, foregroundWindowTask, inputActivityTask, sessionStateTask);

        return new SessionCaptureEnvelope
        {
            CapturedAtUtc = capturedAtUtc,
            Screens = await screensTask,
            ForegroundWindow = await foregroundWindowTask,
            InputActivity = await inputActivityTask,
            SessionState = await sessionStateTask
        };
    }
}
