using System.Drawing;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed class LauncherForm : Form
{
    private readonly AgentProcessManager _agentProcessManager = new();
    private readonly AttendanceStore _attendanceStore = new();
    private readonly AttendanceReporter _attendanceReporter = new();
    private readonly System.Windows.Forms.Timer _durationTimer = new();

    private readonly Panel _loginPanel = new();
    private readonly Panel _attendancePanel = new();
    private readonly TextBox _employeeTextBox = new();
    private readonly Label _loginErrorLabel = new();
    private Label _employeeLabel = null!;
    private Label _clockInLabel = null!;
    private Label _durationLabel = null!;
    private Label _agentStatusLabel = null!;
    private Label _recordPathLabel = null!;
    private Label _syncStatusLabel = null!;
    private readonly Button _clockOutButton = new();

    private string _currentEmployeeCode = string.Empty;
    private DateTimeOffset? _clockInAt;
    private DateTimeOffset? _clockOutAt;

    public LauncherForm()
    {
        Text = "Employee Clock";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(480, 520);
        Size = new Size(520, 560);
        Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
        BackColor = Color.FromArgb(245, 247, 250);

        BuildLoginPanel();
        BuildAttendancePanel();

        Controls.Add(_loginPanel);
        Controls.Add(_attendancePanel);

        _durationTimer.Interval = 1000;
        _durationTimer.Tick += (_, _) => RefreshDuration();

        Shown += (_, _) => _employeeTextBox.Focus();
    }

    private void BuildLoginPanel()
    {
        _loginPanel.Dock = DockStyle.Fill;
        _loginPanel.Padding = new Padding(36);

        var title = CreateLabel("Employee Clock", 22, FontStyle.Bold);
        title.Height = 44;
        title.Dock = DockStyle.Top;

        var subtitle = CreateLabel("Start your work session and launch the approved monitoring agent.", 10, FontStyle.Regular);
        subtitle.ForeColor = Color.FromArgb(92, 101, 116);
        subtitle.Height = 42;
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
            Text = "Clock in and start agent",
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

        _clockInLabel = CreateLabel(string.Empty, 13, FontStyle.Bold);
        _clockInLabel.Height = 42;
        _clockInLabel.Dock = DockStyle.Top;

        _durationLabel = CreateLabel("Worked 00:00:00", 18, FontStyle.Bold);
        _durationLabel.ForeColor = Color.FromArgb(24, 119, 242);
        _durationLabel.Height = 58;
        _durationLabel.Dock = DockStyle.Top;

        _agentStatusLabel = CreateLabel(string.Empty, 10, FontStyle.Regular);
        _agentStatusLabel.ForeColor = Color.FromArgb(74, 85, 104);
        _agentStatusLabel.Height = 68;
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
        _currentEmployeeCode = employeeCode;
        _clockInAt = DateTimeOffset.Now;

        AgentProcessStatus processStatus;
        try
        {
            processStatus = _agentProcessManager.StartAgentProcesses();
        }
        catch (Exception ex)
        {
            _loginErrorLabel.Text = ex.Message;
            return;
        }

        await _attendanceStore.AppendAsync("clock_in", _currentEmployeeCode, _clockInAt.Value);
        var syncStatus = await _attendanceReporter.TryReportAsync("clock_in", _currentEmployeeCode, _clockInAt.Value);
        ShowAttendance(processStatus);
        _syncStatusLabel.Text = $"Sync: {syncStatus}";
    }

    private async Task ClockOutAsync()
    {
        if (_clockOutAt is not null || string.IsNullOrWhiteSpace(_currentEmployeeCode))
        {
            return;
        }

        _clockOutAt = DateTimeOffset.Now;
        await _attendanceStore.AppendAsync("clock_out", _currentEmployeeCode, _clockOutAt.Value);
        var syncStatus = await _attendanceReporter.TryReportAsync("clock_out", _currentEmployeeCode, _clockOutAt.Value);
        _syncStatusLabel.Text = $"Sync: {syncStatus}";
        _clockOutButton.Enabled = false;
        _clockOutButton.Text = $"Clocked out at {_clockOutAt.Value:HH:mm:ss}";
        RefreshDuration();
    }

    private void ShowAttendance(AgentProcessStatus status)
    {
        _employeeLabel.Text = $"Employee: {_currentEmployeeCode}";
        _clockInLabel.Text = $"Clock-in time: {_clockInAt:yyyy-MM-dd HH:mm:ss}";
        _agentStatusLabel.Text = BuildAgentStatusText(status);

        _loginPanel.Visible = false;
        _attendancePanel.Visible = true;
        _durationTimer.Start();
        RefreshDuration();
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

    private static string BuildAgentStatusText(AgentProcessStatus status)
    {
        return
            $"Service PID: {FormatPid(status.ServiceProcessId)}    SessionHelper PID: {FormatPid(status.HelperProcessId)}" +
            Environment.NewLine +
            "Agent is running in the background.";
    }

    private static string FormatPid(int? processId)
    {
        return processId?.ToString() ?? "not running";
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
