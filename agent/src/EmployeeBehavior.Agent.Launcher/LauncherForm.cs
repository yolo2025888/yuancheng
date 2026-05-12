using System.Drawing;
using System.Text.Json;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed class LauncherForm : Form
{
    private readonly AgentProcessManager _agentProcessManager = new();
    private readonly AttendanceStore _attendanceStore = new();
    private readonly AttendanceReporter _attendanceReporter = new();
    private readonly EmployeeProfileResolver _employeeProfileResolver = new();
    private readonly System.Windows.Forms.Timer _durationTimer = new();
    private readonly SemaphoreSlim _syncLock = new(1, 1);

    private readonly Panel _loginPanel = new();
    private readonly Panel _attendancePanel = new();
    private readonly TextBox _employeeTextBox = new();
    private readonly Label _loginErrorLabel = new();
    private readonly Label _loginSyncStatusLabel = new();
    private Label _employeeLabel = null!;
    private Label _ruleSummaryLabel = null!;
    private Label _clockInLabel = null!;
    private Label _durationLabel = null!;
    private Label _agentStatusLabel = null!;
    private Label _recordPathLabel = null!;
    private Label _syncStatusLabel = null!;
    private readonly Button _clockOutButton = new();

    private string _currentEmployeeCode = string.Empty;
    private EmployeeProfile? _currentEmployeeProfile;
    private DateTimeOffset? _clockInAt;
    private DateTimeOffset? _clockOutAt;

    public LauncherForm()
    {
        Text = "Employee Clock";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(480, 560);
        Size = new Size(520, 600);
        Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
        BackColor = Color.FromArgb(245, 247, 250);

        BuildLoginPanel();
        BuildAttendancePanel();

        Controls.Add(_loginPanel);
        Controls.Add(_attendancePanel);

        _durationTimer.Interval = 1000;
        _durationTimer.Tick += (_, _) => RefreshDuration();

        Shown += (_, _) =>
        {
            _employeeTextBox.Focus();
            _ = ReplayPendingAsync("startup");
        };
    }

    private Task<AgentProcessStatus> StartAgentProcessesAsync()
    {
        return Task.Run(() => _agentProcessManager.StartAgentProcesses());
    }

    private void BuildLoginPanel()
    {
        _loginPanel.Dock = DockStyle.Fill;
        _loginPanel.Padding = new Padding(36);

        var title = CreateLabel("Employee Clock", 22, FontStyle.Bold);
        title.Height = 44;
        title.Dock = DockStyle.Top;

        var subtitle = CreateLabel(
            "Clock in records attendance and enables company-device monitoring for this work session. Portable packages start the local background agent after clock-in; installed devices keep the Windows service/session helper under system control and the launcher shows current background status." +
            Environment.NewLine +
            "Monitoring includes full screenshots on all displays; active window title, process name/path, session/lock/RDP/idle metadata; aggregate keyboard/mouse counts." +
            Environment.NewLine +
            "Purpose: attendance, work-risk review, and code/data leakage investigation by authorized admins. Retention and appeal follow company HR/IT policy." +
            Environment.NewLine +
            "No raw keystrokes, clipboard, camera, microphone, or remote control.",
            8.5F,
            FontStyle.Regular);
        subtitle.ForeColor = Color.FromArgb(92, 101, 116);
        subtitle.Height = 132;
        subtitle.Dock = DockStyle.Top;

        var employeeLabel = CreateFieldLabel("Employee code");
        _employeeTextBox.Height = 36;
        _employeeTextBox.PlaceholderText = "Enter employee code";
        _employeeTextBox.Dock = DockStyle.Top;
        _employeeTextBox.KeyDown += async (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                await ClockInAsync();
            }
        };

        var clockInButton = new Button
        {
            Text = "Clock in",
            Height = 42,
            Dock = DockStyle.Top,
            BackColor = Color.FromArgb(24, 119, 242),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        clockInButton.FlatAppearance.BorderSize = 0;
        clockInButton.Click += async (_, _) => await ClockInAsync();

        _loginErrorLabel.Height = 30;
        _loginErrorLabel.Dock = DockStyle.Top;
        _loginErrorLabel.ForeColor = Color.FromArgb(190, 45, 45);
        _loginErrorLabel.TextAlign = ContentAlignment.MiddleLeft;

        _loginSyncStatusLabel.Height = 34;
        _loginSyncStatusLabel.Dock = DockStyle.Top;
        _loginSyncStatusLabel.ForeColor = Color.FromArgb(74, 85, 104);
        _loginSyncStatusLabel.TextAlign = ContentAlignment.MiddleLeft;
        _loginSyncStatusLabel.Text = "Sync: checking pending records...";

        AddTop(_loginPanel, _loginSyncStatusLabel, 12);
        AddTop(_loginPanel, _loginErrorLabel);
        AddTop(_loginPanel, clockInButton, 16);
        AddTop(_loginPanel, _employeeTextBox, 4);
        AddTop(_loginPanel, employeeLabel, 28);
        AddTop(_loginPanel, subtitle);
        AddTop(_loginPanel, title);
    }

    private void BuildAttendancePanel()
    {
        _attendancePanel.Dock = DockStyle.Fill;
        _attendancePanel.Padding = new Padding(36);
        _attendancePanel.Visible = false;

        var title = CreateLabel("Work Session Active", 22, FontStyle.Bold);
        title.Height = 48;
        title.Dock = DockStyle.Top;

        _employeeLabel = CreateLabel(string.Empty, 12, FontStyle.Regular);
        _employeeLabel.Height = 34;
        _employeeLabel.Dock = DockStyle.Top;

        _ruleSummaryLabel = CreateLabel(string.Empty, 10, FontStyle.Regular);
        _ruleSummaryLabel.ForeColor = Color.FromArgb(74, 85, 104);
        _ruleSummaryLabel.Height = 78;
        _ruleSummaryLabel.Dock = DockStyle.Top;

        _clockInLabel = CreateLabel(string.Empty, 13, FontStyle.Bold);
        _clockInLabel.Height = 42;
        _clockInLabel.Dock = DockStyle.Top;

        _durationLabel = CreateLabel("Worked 00:00:00", 18, FontStyle.Bold);
        _durationLabel.ForeColor = Color.FromArgb(24, 119, 242);
        _durationLabel.Height = 58;
        _durationLabel.Dock = DockStyle.Top;

        _agentStatusLabel = CreateLabel(string.Empty, 10, FontStyle.Regular);
        _agentStatusLabel.ForeColor = Color.FromArgb(74, 85, 104);
        _agentStatusLabel.Height = 92;
        _agentStatusLabel.Dock = DockStyle.Top;

        _recordPathLabel = CreateLabel($"Attendance log: {_attendanceStore.LogPath}", 9, FontStyle.Regular);
        _recordPathLabel.ForeColor = Color.FromArgb(92, 101, 116);
        _recordPathLabel.Height = 54;
        _recordPathLabel.Dock = DockStyle.Top;

        _syncStatusLabel = CreateLabel("Sync: waiting for clock event", 10, FontStyle.Regular);
        _syncStatusLabel.ForeColor = Color.FromArgb(74, 85, 104);
        _syncStatusLabel.Height = 34;
        _syncStatusLabel.Dock = DockStyle.Top;

        _clockOutButton.Text = "Clock out";
        _clockOutButton.Height = 42;
        _clockOutButton.Dock = DockStyle.Top;
        _clockOutButton.BackColor = Color.FromArgb(52, 58, 64);
        _clockOutButton.ForeColor = Color.White;
        _clockOutButton.FlatStyle = FlatStyle.Flat;
        _clockOutButton.FlatAppearance.BorderSize = 0;
        _clockOutButton.Click += async (_, _) => await ClockOutAsync();

        AddTop(_attendancePanel, _recordPathLabel, 18);
        AddTop(_attendancePanel, _syncStatusLabel, 12);
        AddTop(_attendancePanel, _clockOutButton, 22);
        AddTop(_attendancePanel, _agentStatusLabel, 26);
        AddTop(_attendancePanel, _durationLabel, 12);
        AddTop(_attendancePanel, _clockInLabel, 20);
        AddTop(_attendancePanel, _ruleSummaryLabel);
        AddTop(_attendancePanel, _employeeLabel);
        AddTop(_attendancePanel, title);
    }

    private async Task ClockInAsync()
    {
        var employeeCode = _employeeTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(employeeCode))
        {
            _loginErrorLabel.Text = "Enter an employee code.";
            return;
        }

        _loginErrorLabel.Text = string.Empty;
        _loginSyncStatusLabel.Text = "Resolving employee profile...";
        _currentEmployeeCode = employeeCode;
        _currentEmployeeProfile = await _employeeProfileResolver.ResolveAsync(employeeCode);
        _clockInAt = DateTimeOffset.Now;
        await _attendanceStore.SetWorkSessionStateAsync("clock_in", _currentEmployeeProfile, _clockInAt.Value);

        AgentProcessStatus processStatus;
        try
        {
            processStatus = await StartAgentProcessesAsync();
        }
        catch (Exception ex)
        {
            await _attendanceStore.SetWorkSessionStateAsync("clock_out", _currentEmployeeProfile, _clockInAt.Value);
            _loginErrorLabel.Text = ex.Message;
            return;
        }

        await _attendanceStore.AppendAsync("clock_in", _currentEmployeeProfile, _clockInAt.Value);
        ShowAttendance(processStatus);
        _ = RefreshRuleSummaryAsync();
        _ = ReplayPendingAsync("clock-in");
    }

    private async Task ClockOutAsync()
    {
        if (_clockOutAt is not null || _currentEmployeeProfile is null)
        {
            return;
        }

        _clockOutAt = DateTimeOffset.Now;
        await _attendanceStore.AppendAsync("clock_out", _currentEmployeeProfile, _clockOutAt.Value);
        await _attendanceStore.SetWorkSessionStateAsync("clock_out", _currentEmployeeProfile, _clockOutAt.Value);
        _ = ReplayPendingAsync("clock-out");
        _clockOutButton.Enabled = false;
        _clockOutButton.Text = $"Clocked out at {_clockOutAt.Value:HH:mm:ss}";
        RefreshDuration();
    }

    private void ShowAttendance(AgentProcessStatus status)
    {
        var profile = _currentEmployeeProfile ?? EmployeeProfile.LocalFallback(_currentEmployeeCode, "not resolved");
        _employeeLabel.Text = BuildEmployeeText(profile);
        _ruleSummaryLabel.Text = BuildRuleSummaryText(profile);
        _clockInLabel.Text = $"Clock-in time: {_clockInAt:yyyy-MM-dd HH:mm:ss}";
        _agentStatusLabel.Text = BuildAgentStatusText(status);

        _loginPanel.Visible = false;
        _attendancePanel.Visible = true;
        _durationTimer.Start();
        RefreshDuration();
    }

    private static string BuildEmployeeText(EmployeeProfile profile)
    {
        var department = string.IsNullOrWhiteSpace(profile.Department) ? string.Empty : $"    Department: {profile.Department}";
        return $"Employee: {profile.DisplayName} ({profile.EmployeeNo}){department}";
    }

    private static string BuildRuleSummaryText(EmployeeProfile profile)
    {
        var ruleSummary = string.IsNullOrWhiteSpace(profile.RuleSummary) ? EmployeeProfile.DefaultRuleSummary : profile.RuleSummary;
        var ruleStatus = string.IsNullOrWhiteSpace(profile.RuleStatus) ? string.Empty : $"{Environment.NewLine}Rule status: {profile.RuleStatus}";
        return
            $"Profile: {profile.Source} - {profile.Message}{Environment.NewLine}" +
            $"Rule source: {profile.RuleSource}{Environment.NewLine}" +
            $"Rules: {ruleSummary}{ruleStatus}";
    }

    private void RefreshDuration()
    {
        if (_clockInAt is null)
        {
            return;
        }

        var end = _clockOutAt ?? DateTimeOffset.Now;
        var duration = end - _clockInAt.Value;
        _durationLabel.Text = $"Worked {duration:hh\\:mm\\:ss}";

        if (_clockOutAt is null)
        {
            _agentStatusLabel.Text = BuildAgentStatusText(_agentProcessManager.GetStatus());
        }
    }

    private async Task RefreshRuleSummaryAsync()
    {
        var profile = _currentEmployeeProfile;
        if (profile is null)
        {
            return;
        }

        try
        {
            var refreshed = await _employeeProfileResolver.ResolveRuleSummaryAsync(profile);
            _currentEmployeeProfile = refreshed;
            _ruleSummaryLabel.Text = BuildRuleSummaryText(refreshed);
        }
        catch (Exception ex) when (
            ex is IOException or HttpRequestException or JsonException or InvalidOperationException or TaskCanceledException)
        {
            var fallbackProfile = profile.WithLocalDefaultRules($"{ex.GetType().Name}: {ex.Message}");
            _currentEmployeeProfile = fallbackProfile;
            _ruleSummaryLabel.Text = BuildRuleSummaryText(fallbackProfile);
        }
    }

    private async Task ReplayPendingAsync(string reason)
    {
        if (!await _syncLock.WaitAsync(0))
        {
            UpdateSyncStatus("sync already running");
            return;
        }

        try
        {
            var pending = (await _attendanceStore.LoadPendingAsync()).ToList();
            if (pending.Count == 0)
            {
                UpdateSyncStatus("all records synced");
                return;
            }

            UpdateSyncStatus($"syncing {pending.Count} pending record(s) after {reason}...");
            var remaining = new List<AttendanceRecord>();
            var synced = 0;
            string? lastError = null;

            foreach (var record in pending)
            {
                var result = await _attendanceReporter.TryReportAsync(record);
                if (result.IsSynced)
                {
                    synced++;
                    continue;
                }

                lastError = result.Message;
                remaining.Add(record.MarkAttemptFailed(result.Message));
            }

            await _attendanceStore.ReplaceReplayedPendingAsync(
                pending.Select(record => record.Id),
                remaining);

            if (remaining.Count == 0)
            {
                UpdateSyncStatus($"synced {synced} record(s); queue empty");
            }
            else
            {
                UpdateSyncStatus(
                    $"synced {synced}; {remaining.Count} pending. Last error: {FormatSyncError(lastError)}");
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            UpdateSyncStatus($"local saved; sync queue error: {ex.GetType().Name}");
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private void UpdateSyncStatus(string message)
    {
        var text = $"Sync: {message}";
        _loginSyncStatusLabel.Text = text;
        if (_syncStatusLabel is not null)
        {
            _syncStatusLabel.Text = text;
        }
    }

    private static string FormatSyncError(string? error)
    {
        if (string.IsNullOrWhiteSpace(error))
        {
            return "unknown";
        }

        const int maxLength = 96;
        return error.Length <= maxLength ? error : error[..maxLength] + "...";
    }

    private static string BuildAgentStatusText(AgentProcessStatus status)
    {
        var processLine =
            $"Service PID: {FormatPid(status.ServiceProcessId)}    SessionHelper PID: {FormatPid(status.HelperProcessId)}";

        if (status.IsInstalledDeployment)
        {
            var installedComponents = DescribeInstalledComponents(status);
            var lifecycleLine = status.HasAnyRunningProcess()
                ? $"Installed {installedComponents} detected. Launcher recorded clock-in without starting local background processes."
                : $"Installed {installedComponents} detected. Launcher recorded clock-in and is showing that the managed background components are not running yet.";
            return processLine + Environment.NewLine + lifecycleLine;
        }

        if (status.ServiceStarted || status.HelperStarted)
        {
            return processLine + Environment.NewLine + "Launcher started the local background agent for this portable session.";
        }

        if (status.HasAnyRunningProcess())
        {
            return processLine + Environment.NewLine + "Local background monitoring was already running before this clock-in.";
        }

        return processLine + Environment.NewLine + "Background monitoring is not running.";
    }

    private static string FormatPid(int? processId)
    {
        return processId?.ToString() ?? "not running";
    }

    private static string DescribeInstalledComponents(AgentProcessStatus status)
    {
        var components = new List<string>();
        if (status.ServiceInstalled)
        {
            components.Add("Windows service");
        }

        if (status.HelperTaskInstalled)
        {
            components.Add("logon helper task");
        }

        return components.Count switch
        {
            0 => "background components",
            1 => components[0],
            _ => string.Join(" and ", components)
        };
    }

    private static Label CreateLabel(string text, float size, FontStyle style)
    {
        return new Label
        {
            Text = text,
            AutoSize = false,
            Font = new Font("Microsoft YaHei UI", size, style, GraphicsUnit.Point),
            TextAlign = ContentAlignment.MiddleLeft
        };
    }

    private static Label CreateFieldLabel(string text)
    {
        var label = CreateLabel(text, 10, FontStyle.Bold);
        label.Height = 28;
        label.Dock = DockStyle.Top;
        return label;
    }

    private static void AddTop(Control parent, Control child, int marginTop = 0)
    {
        child.Margin = new Padding(0, marginTop, 0, 0);
        parent.Controls.Add(child);
        parent.Controls.SetChildIndex(child, 0);
    }
}
