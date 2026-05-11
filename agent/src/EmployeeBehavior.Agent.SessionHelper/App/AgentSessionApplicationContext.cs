using System.Drawing;
using EmployeeBehavior.Agent.Contracts.Models;
using Microsoft.Extensions.Logging;

namespace EmployeeBehavior.Agent.SessionHelper.App;

public sealed class AgentSessionApplicationContext : ApplicationContext
{
    private readonly ILogger<AgentSessionApplicationContext> _logger;
    private readonly NotifyIcon _notifyIcon;
    private readonly ISessionSnapshotCollector _sessionSnapshotCollector;

    public AgentSessionApplicationContext(
        ISessionSnapshotCollector sessionSnapshotCollector,
        ILogger<AgentSessionApplicationContext> logger)
    {
        _logger = logger;
        _sessionSnapshotCollector = sessionSnapshotCollector;

        var captureMenuItem = new ToolStripMenuItem("Capture Sample");
        captureMenuItem.Click += async (_, _) => await CaptureSnapshotAsync();

        var exitMenuItem = new ToolStripMenuItem("Exit");
        exitMenuItem.Click += (_, _) => ExitThread();

        _notifyIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Employee Behavior Session Helper",
            Visible = true,
            ContextMenuStrip = new ContextMenuStrip()
        };

        _notifyIcon.ContextMenuStrip.Items.Add(captureMenuItem);
        _notifyIcon.ContextMenuStrip.Items.Add(exitMenuItem);
        _notifyIcon.DoubleClick += async (_, _) => await CaptureSnapshotAsync();
    }

    private async Task CaptureSnapshotAsync()
    {
        SessionCaptureEnvelope snapshot = await _sessionSnapshotCollector.CaptureAsync(CancellationToken.None);
        _logger.LogInformation(
            "Manual tray capture completed. Foreground={ForegroundWindow}; Screens={ScreenCount}.",
            snapshot.ForegroundWindow?.WindowTitle,
            snapshot.Screens.Count);

        _notifyIcon.ShowBalloonTip(
            2000,
            "Session Helper",
            $"Captured {snapshot.Screens.Count} screen metadata item(s).",
            ToolTipIcon.Info);
    }

    protected override void ExitThreadCore()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        base.ExitThreadCore();
    }
}
