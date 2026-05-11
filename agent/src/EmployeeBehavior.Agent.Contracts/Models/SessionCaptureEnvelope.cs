namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record SessionCaptureEnvelope
{
    public DateTimeOffset CapturedAtUtc { get; init; } = DateTimeOffset.UtcNow;

    public ForegroundWindowInfo? ForegroundWindow { get; init; }

    public InputActivitySnapshot? InputActivity { get; init; }

    public SessionStateSnapshot? SessionState { get; init; }

    public IReadOnlyList<CapturedScreen> Screens { get; init; } = Array.Empty<CapturedScreen>();
}
