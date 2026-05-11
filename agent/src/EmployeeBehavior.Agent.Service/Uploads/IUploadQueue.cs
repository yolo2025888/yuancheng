namespace EmployeeBehavior.Agent.Service.Uploads;

public interface IUploadQueue
{
    ValueTask EnqueueAsync(QueuedUploadItem item, CancellationToken cancellationToken);

    ValueTask<IReadOnlyList<QueuedUploadItem>> DequeueBatchAsync(int maxItems, CancellationToken cancellationToken);
}
