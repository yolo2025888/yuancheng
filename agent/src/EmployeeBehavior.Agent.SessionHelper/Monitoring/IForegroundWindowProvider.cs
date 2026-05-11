using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.Monitoring;

public interface IForegroundWindowProvider
{
    Task<ForegroundWindowInfo> GetCurrentAsync(CancellationToken cancellationToken);
}
