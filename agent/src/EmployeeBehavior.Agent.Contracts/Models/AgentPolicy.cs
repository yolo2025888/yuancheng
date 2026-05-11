namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record AgentPolicy
{
    public string Version { get; init; } = "bootstrap";

    public bool CaptureEnabled { get; init; } = true;

    public int ScreenshotIntervalSeconds { get; init; } = 10;

    public int NoChangeThreshold { get; init; } = 6;

    public int HighRiskDurationMinutes { get; init; } = 5;

    public string GithubRiskWeight { get; init; } = "high";

    public string FileTransferRiskWeight { get; init; } = "high";

    public IReadOnlyList<string> NormalApps { get; init; } = Array.Empty<string>();

    public IReadOnlyList<string> LowChangeContexts { get; init; } = Array.Empty<string>();

    public static AgentPolicy CreateDefault() =>
        new()
        {
            Version = "default",
            CaptureEnabled = true,
            ScreenshotIntervalSeconds = 10,
            NoChangeThreshold = 6,
            HighRiskDurationMinutes = 5,
            GithubRiskWeight = "high",
            FileTransferRiskWeight = "high",
            NormalApps = new[]
            {
                "IDE",
                "Terminal",
                "Browser",
                "Git Client",
                "Database Tool"
            },
            LowChangeContexts = new[]
            {
                "documentation",
                "terminal",
                "code_review"
            }
        };
}
