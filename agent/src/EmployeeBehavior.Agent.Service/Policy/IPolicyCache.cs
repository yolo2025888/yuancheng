using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.Service.Policy;

public interface IPolicyCache
{
    AgentPolicy Current { get; }

    void Update(AgentPolicy policy);
}
