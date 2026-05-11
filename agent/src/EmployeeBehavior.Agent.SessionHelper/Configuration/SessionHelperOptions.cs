namespace EmployeeBehavior.Agent.SessionHelper.Configuration;

public sealed class SessionHelperOptions
{
    public const string SectionName = "SessionHelper";

    public string PipeName { get; set; } = "employee-behavior-agent";

    public bool EnableTrayIcon { get; set; } = true;

    public bool RunInConsole { get; set; }

    public bool EnableInputActivityHooks { get; set; } = true;

    public bool EnableDesktopStateInspection { get; set; } = true;

    public int InputHookStartupTimeoutSeconds { get; set; } = 5;

    public int SampleLogIntervalSeconds { get; set; } = 60;
}
