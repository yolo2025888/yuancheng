using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.Monitoring;

public sealed class Win32ForegroundWindowProvider : IForegroundWindowProvider
{
    public Task<ForegroundWindowInfo> GetCurrentAsync(CancellationToken cancellationToken)
    {
        var handle = GetForegroundWindow();
        if (handle == IntPtr.Zero)
        {
            return Task.FromResult(new ForegroundWindowInfo
            {
                CollectedAtUtc = DateTimeOffset.UtcNow
            });
        }

        var titleBuilder = new StringBuilder(512);
        _ = GetWindowText(handle, titleBuilder, titleBuilder.Capacity);
        _ = GetWindowThreadProcessId(handle, out var processId);

        var processName = string.Empty;
        var executablePath = string.Empty;

        try
        {
            using var process = Process.GetProcessById((int)processId);
            processName = process.ProcessName;

            try
            {
                executablePath = process.MainModule?.FileName ?? string.Empty;
            }
            catch
            {
                executablePath = string.Empty;
            }
        }
        catch
        {
            processName = string.Empty;
        }

        return Task.FromResult(new ForegroundWindowInfo
        {
            CollectedAtUtc = DateTimeOffset.UtcNow,
            WindowTitle = titleBuilder.ToString(),
            ProcessName = processName,
            ExecutablePath = executablePath
        });
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
