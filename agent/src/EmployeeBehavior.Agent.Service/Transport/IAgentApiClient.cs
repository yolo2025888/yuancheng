using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.Service.Transport;

public interface IAgentApiClient
{
    Task<HeartbeatResponse> SendHeartbeatAsync(HeartbeatRequest request, CancellationToken cancellationToken);

    Task<AgentPolicy> GetPolicyAsync(CancellationToken cancellationToken);

    Task<ScreenshotUploadResponse> UploadScreenshotAsync(
        ScreenshotUploadRequest request,
        CancellationToken cancellationToken);

    Task CompleteScreenshotAsync(
        ScreenshotUploadCompleteRequest request,
        CancellationToken cancellationToken);
}
