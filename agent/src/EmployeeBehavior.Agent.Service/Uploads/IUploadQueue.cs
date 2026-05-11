namespace EmployeeBehavior.Agent.Service.Uploads;

public interface IUploadQueue
{
    ValueTask EnqueueAsync(QueuedUploadItem item, CancellationToken cancellationToken);

    ValueTask<UploadQueueLease> LeaseBatchAsync(int maxItems, CancellationToken cancellationToken);

    ValueTask CompleteAsync(
        string leaseId,
        IReadOnlyCollection<Guid> localIds,
        CancellationToken cancellationToken);

    ValueTask ReleaseAsync(
        string leaseId,
        IReadOnlyCollection<Guid> localIds,
        CancellationToken cancellationToken);
}
