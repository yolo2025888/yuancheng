using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.App;

public interface ISessionSnapshotCollector
{
    Task<SessionCaptureEnvelope> CaptureAsync(CancellationToken cancellationToken);
}
