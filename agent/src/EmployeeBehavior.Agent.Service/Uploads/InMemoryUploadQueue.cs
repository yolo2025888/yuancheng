using System.Threading.Channels;

namespace EmployeeBehavior.Agent.Service.Uploads;

public sealed class InMemoryUploadQueue : IUploadQueue
{
    private readonly Channel<QueuedUploadItem> _channel = Channel.CreateUnbounded<QueuedUploadItem>(
        new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

    public async ValueTask EnqueueAsync(QueuedUploadItem item, CancellationToken cancellationToken)
    {
        await _channel.Writer.WriteAsync(item, cancellationToken);
    }

    public async ValueTask<IReadOnlyList<QueuedUploadItem>> DequeueBatchAsync(
        int maxItems,
        CancellationToken cancellationToken)
    {
        var batch = new List<QueuedUploadItem>(Math.Max(1, maxItems));
        if (!await _channel.Reader.WaitToReadAsync(cancellationToken))
        {
            return batch;
        }

        while (batch.Count < maxItems && _channel.Reader.TryRead(out var item))
        {
            batch.Add(item);
        }

        return batch;
    }
}
