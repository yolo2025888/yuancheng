using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.Capture;

public interface IScreenshotCapture
{
    Task<IReadOnlyList<CapturedScreen>> CaptureAsync(CancellationToken cancellationToken);
}
