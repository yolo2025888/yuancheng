namespace EmployeeBehavior.Agent.Service.Uploads;

public sealed record UploadQueueLease(string LeaseId, IReadOnlyList<QueuedUploadItem> Items)
{
    public static UploadQueueLease Empty { get; } = new(string.Empty, Array.Empty<QueuedUploadItem>());
}
