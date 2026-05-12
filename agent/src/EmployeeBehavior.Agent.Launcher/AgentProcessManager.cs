using System.Diagnostics;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed class AgentProcessManager
{
    private const string ServiceProcessName = "EmployeeBehavior.Agent.Service";
    private const string HelperProcessName = "EmployeeBehavior.Agent.SessionHelper";
    private const string ServiceRegistrationName = "EmployeeBehavior.Agent.Service";
    private const string HelperTaskName = "EmployeeBehavior.Agent.SessionHelper";
    private readonly object _startLock = new();

    public AgentProcessStatus StartAgentProcesses()
    {
        lock (_startLock)
        {
            var installationState = DetectInstallationState();
            if (installationState.IsInstalledDeployment)
            {
                return CreateStatus(
                    serviceStarted: false,
                    helperStarted: false,
                    installationState);
            }

            var service = StartIfMissing(
                ServiceProcessName,
                ResolveAgentPath("Service", "EmployeeBehavior.Agent.Service.exe"),
                hideWindow: true);
            var helper = StartIfMissing(
                HelperProcessName,
                ResolveAgentPath("SessionHelper", "EmployeeBehavior.Agent.SessionHelper.exe"),
                hideWindow: true);

            return CreateStatus(
                service.Started,
                helper.Started,
                installationState,
                service.ProcessId,
                helper.ProcessId);
        }
    }

    public AgentProcessStatus GetStatus()
    {
        return CreateStatus(
            serviceStarted: false,
            helperStarted: false,
            DetectInstallationState());
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
            UseShellExecute = !hideWindow,
            CreateNoWindow = hideWindow
        };

        if (hideWindow is false)
        {
            startInfo.WindowStyle = ProcessWindowStyle.Normal;
        }

        var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Failed to start {executablePath}.");
        if (process.WaitForExit(500))
        {
            throw new InvalidOperationException(
                $"{Path.GetFileName(executablePath)} exited immediately with code {process.ExitCode}.");
        }
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

    private static AgentProcessStatus CreateStatus(
        bool serviceStarted,
        bool helperStarted,
        AgentInstallationState installationState,
        int? serviceProcessId = null,
        int? helperProcessId = null)
    {
        serviceProcessId ??= FindProcess(ServiceProcessName)?.Id;
        helperProcessId ??= FindProcess(HelperProcessName)?.Id;

        return new AgentProcessStatus(
            serviceStarted,
            serviceProcessId,
            helperStarted,
            helperProcessId,
            installationState.ServiceInstalled,
            installationState.HelperTaskInstalled,
            installationState.IsInstalledDeployment);
    }

    private static AgentInstallationState DetectInstallationState()
    {
        var serviceInstalled = IsRegistrationPresent(
            "sc.exe",
            $"query \"{ServiceRegistrationName}\"");
        var helperTaskInstalled = IsRegistrationPresent(
            "schtasks.exe",
            $"/Query /TN \"{HelperTaskName}\"");

        return new AgentInstallationState(serviceInstalled, helperTaskInstalled);
    }

    private static bool IsRegistrationPresent(string fileName, string arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        try
        {
            using var process = Process.Start(startInfo);
            if (process is null)
            {
                return false;
            }

            if (!process.WaitForExit(3000))
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (InvalidOperationException)
                {
                }

                return false;
            }

            return process.ExitCode == 0;
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }
}

internal readonly record struct AgentProcessStatus(
    bool ServiceStarted,
    int? ServiceProcessId,
    bool HelperStarted,
    int? HelperProcessId,
    bool ServiceInstalled,
    bool HelperTaskInstalled,
    bool DirectLaunchSuppressed)
{
    public bool IsInstalledDeployment => ServiceInstalled || HelperTaskInstalled;

    public bool HasAnyRunningProcess()
    {
        return ServiceProcessId.HasValue || HelperProcessId.HasValue;
    }
}

internal readonly record struct AgentInstallationState(bool ServiceInstalled, bool HelperTaskInstalled)
{
    public bool IsInstalledDeployment => ServiceInstalled || HelperTaskInstalled;
}
