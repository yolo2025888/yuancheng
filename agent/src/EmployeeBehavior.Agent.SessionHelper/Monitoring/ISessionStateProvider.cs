using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.Monitoring;

public interface ISessionStateProvider
{
    Task<SessionStateSnapshot> GetCurrentAsync(CancellationToken cancellationToken);
}
