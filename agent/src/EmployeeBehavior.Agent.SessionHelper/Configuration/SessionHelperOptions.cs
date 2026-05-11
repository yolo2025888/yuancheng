namespace EmployeeBehavior.Agent.SessionHelper.Configuration;

public sealed class SessionHelperOptions
{
    public const string SectionName = "SessionHelper";

    public string PipeName { get; set; } = "employee-behavior-agent";

    public bool EnableTrayIcon { get; set; } = true;

    public bool RunInConsole { get; set; }

    public int SampleLogIntervalSeconds { get; set; } = 60;
}
