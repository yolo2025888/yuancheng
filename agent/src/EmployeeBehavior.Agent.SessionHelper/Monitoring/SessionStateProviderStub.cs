using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.Monitoring;

public sealed class SessionStateProviderStub : ISessionStateProvider
{
    public Task<SessionStateSnapshot> GetCurrentAsync(CancellationToken cancellationToken)
    {
        return Task.FromResult(new SessionStateSnapshot
        {
            CollectedAtUtc = DateTimeOffset.UtcNow,
            SessionId = Environment.SessionId,
            UserName = Environment.UserName,
            IsLocked = false,
            IsRemoteSession = SystemInformation.TerminalServerSession,
            IsRdpSession = SystemInformation.TerminalServerSession,
            StatusDetail = "Skeleton implementation. Replace with WTS/desktop lock detection."
        });
    }
}
