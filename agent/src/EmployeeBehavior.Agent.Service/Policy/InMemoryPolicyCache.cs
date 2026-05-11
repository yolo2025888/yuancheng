using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.Service.Policy;

public sealed class InMemoryPolicyCache : IPolicyCache
{
    private AgentPolicy _current = AgentPolicy.CreateDefault();

    public AgentPolicy Current => _current;

    public void Update(AgentPolicy policy)
    {
        _current = policy ?? AgentPolicy.CreateDefault();
    }
}
