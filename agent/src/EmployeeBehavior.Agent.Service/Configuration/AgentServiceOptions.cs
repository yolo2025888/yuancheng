using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.Service.Configuration;

public sealed class AgentServiceOptions
{
    public const string SectionName = "AgentService";

    public string ApiBaseUrl { get; set; } = "https://backend.example.internal";

    public string ApiToken { get; set; } = "replace-me";

    public bool DryRun { get; set; } = true;

    public string? EmployeeId { get; set; }

    public string DeviceIdPath { get; set; } = @"C:\ProgramData\EmployeeBehaviorAgent\device-id.json";

    public string SessionHelperPipeName { get; set; } = "employee-behavior-agent";

    public int SessionHelperConnectTimeoutSeconds { get; set; } = 3;

    public int SessionHelperRequestTimeoutSeconds { get; set; } = 30;

    public int HeartbeatIntervalSeconds { get; set; } = 30;

    public int PolicyRefreshIntervalSeconds { get; set; } = 300;

    public int UploadPollIntervalSeconds { get; set; } = 5;

    public int UploadBatchSize { get; set; } = 2;

    public string UploadQueuePath { get; set; } = @"C:\ProgramData\EmployeeBehaviorAgent\upload-queue.jsonl";

    public int UploadQueueLeaseDurationSeconds { get; set; } = 300;

    public AgentPolicy DefaultPolicy { get; set; } = AgentPolicy.CreateDefault();
}
