namespace EmployeeBehavior.Agent.Launcher;

internal sealed record LauncherAutomationOptions(
    string? AutoClockInEmployeeCode,
    bool ExitAfterClockIn)
{
    public bool IsEnabled => !string.IsNullOrWhiteSpace(AutoClockInEmployeeCode);

    public static LauncherAutomationOptions Parse(string[] args)
    {
        string? employeeCode = null;
        var exitAfterClockIn = false;

        for (var index = 0; index < args.Length; index++)
        {
            var argument = args[index];
            if (string.Equals(argument, "--auto-clock-in", StringComparison.OrdinalIgnoreCase))
            {
                if (index + 1 >= args.Length)
                {
                    throw new ArgumentException("--auto-clock-in requires an employee code value.");
                }

                employeeCode = args[++index];
                continue;
            }

            if (string.Equals(argument, "--exit-after-clock-in", StringComparison.OrdinalIgnoreCase))
            {
                exitAfterClockIn = true;
            }
        }

        return new LauncherAutomationOptions(employeeCode, exitAfterClockIn);
    }
}
