namespace EmployeeBehavior.Agent.Contracts.Models;

public sealed record WorkSessionState
{
    public string SessionStatus { get; init; } = "clocked_out";

    public string? EmployeeNo { get; init; }

    public string? EmployeeDisplayName { get; init; }

    public DateTimeOffset UpdatedAt { get; init; } = DateTimeOffset.UtcNow;

    public bool MonitoringActive =>
        string.Equals(SessionStatus, "clocked_in", StringComparison.OrdinalIgnoreCase);

    public static WorkSessionState Inactive() =>
        new()
        {
            SessionStatus = "clocked_out",
            UpdatedAt = DateTimeOffset.UtcNow
        };

    public static WorkSessionState Active(
        string? employeeNo,
        string? employeeDisplayName,
        DateTimeOffset updatedAt) =>
        new()
        {
            SessionStatus = "clocked_in",
            EmployeeNo = employeeNo,
            EmployeeDisplayName = employeeDisplayName,
            UpdatedAt = updatedAt
        };
}
