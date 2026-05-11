using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.SessionHelper.Monitoring;

public sealed class InputActivityCounterStub : IInputActivityCounter
{
    private readonly ILogger<InputActivityCounterStub> _logger;
    private DateTimeOffset _lastCollectedAtUtc = DateTimeOffset.UtcNow;

    public InputActivityCounterStub(ILogger<InputActivityCounterStub> logger)
    {
        _logger = logger;
    }

    public Task<InputActivitySnapshot> GetSnapshotAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var snapshot = new InputActivitySnapshot
        {
            CollectedFromUtc = _lastCollectedAtUtc,
            CollectedToUtc = now,
            KeyboardEventCount = 0,
            MouseEventCount = 0,
            WindowSwitchCount = 0
        };

        _lastCollectedAtUtc = now;

        // TODO: Replace with low-level hook or Raw Input based counters. Do not capture key content.
        _logger.LogDebug("Input activity stub emitted zero-count snapshot.");
        return Task.FromResult(snapshot);
    }
}
