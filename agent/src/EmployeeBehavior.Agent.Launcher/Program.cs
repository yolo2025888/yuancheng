namespace EmployeeBehavior.Agent.Launcher;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var automationOptions = LauncherAutomationOptions.Parse(args);
        Application.Run(new LauncherForm(automationOptions));
    }
}
