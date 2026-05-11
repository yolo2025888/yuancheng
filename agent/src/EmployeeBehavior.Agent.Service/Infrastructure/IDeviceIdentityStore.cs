namespace EmployeeBehavior.Agent.Service.Infrastructure;

public interface IDeviceIdentityStore
{
    ValueTask<string> GetOrCreateAsync(CancellationToken cancellationToken);
}
