using EmployeeBehavior.Agent.Contracts.Models;

namespace EmployeeBehavior.Agent.Service.Uploads;

public sealed record QueuedUploadItem(Guid LocalId, ScreenshotUploadRequest Request);
