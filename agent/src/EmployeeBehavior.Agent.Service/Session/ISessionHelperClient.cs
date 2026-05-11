using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.Service.Session;

public interface ISessionHelperClient
{
    Task<SessionCaptureEnvelope?> CaptureSnapshotAsync(CancellationToken cancellationToken);
}
