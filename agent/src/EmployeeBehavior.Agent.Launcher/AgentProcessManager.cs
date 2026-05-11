using System.Diagnostics;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed class AgentProcessManager
{
    private const string ServiceProcessName = "EmployeeBehavior.Agent.Service";
    private const string HelperProcessName = "EmployeeBehavior.Agent.SessionHelper";

    public AgentProcessStatus StartAgentProcesses()
    {
        var service = StartIfMissing(
            ServiceProcessName,
            ResolveAgentPath("Service", "EmployeeBehavior.Agent.Service.exe"),
            hideWindow: true);
        var helper = StartIfMissing(
            HelperProcessName,
            ResolveAgentPath("SessionHelper", "EmployeeBehavior.Agent.SessionHelper.exe"),
            hideWindow: true);

        return new AgentProcessStatus(service.Started, service.ProcessId, helper.Started, helper.ProcessId);
    }

    public AgentProcessStatus GetStatus()
    {
        var service = FindProcess(ServiceProcessName);
        var helper = FindProcess(HelperProcessName);
        return new AgentProcessStatus(false, service?.Id, false, helper?.Id);
    }

    private static (bool Started, int? ProcessId) StartIfMissing(string processName, string executablePath, bool hideWindow)
    {
        var existing = FindProcess(processName);
        if (existing is not null)
        {
            return (false, existing.Id);
        }

        if (!File.Exists(executablePath))
        {
            throw new FileNotFoundException($"Agent executable not found: {executablePath}", executablePath);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            WorkingDirectory = Path.GetDirectoryName(executablePath) ?? AppContext.BaseDirectory,
            UseShellExecute = true
        };

        if (hideWindow)
        {
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
        }

        var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Failed to start {executablePath}.");
        return (true, process.Id);
    }

    private static Process? FindProcess(string processName)
    {
        return Process.GetProcessesByName(processName).FirstOrDefault(process => !process.HasExited);
    }

    private static string ResolveAgentPath(string directoryName, string executableName)
    {
        var baseDirectory = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDirectory, directoryName, executableName),
            Path.Combine(Directory.GetParent(baseDirectory.TrimEnd(Path.DirectorySeparatorChar))?.FullName ?? baseDirectory, directoryName, executableName),
            Path.Combine(baseDirectory, "..", directoryName, executableName)
        };

        return candidates
            .Select(Path.GetFullPath)
            .FirstOrDefault(File.Exists)
            ?? Path.GetFullPath(candidates[0]);
    }
}

internal readonly record struct AgentProcessStatus(
    bool ServiceStarted,
    int? ServiceProcessId,
    bool HelperStarted,
    int? HelperProcessId);
