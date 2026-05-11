using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.Monitoring;

public interface IInputActivityCounter
{
    Task<InputActivitySnapshot> GetSnapshotAsync(CancellationToken cancellationToken);
}
