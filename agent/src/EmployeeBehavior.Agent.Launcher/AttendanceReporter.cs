using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed class AttendanceReporter
{
    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(5)
    };

    public async Task<AttendanceSyncAttemptResult> TryReportAsync(AttendanceRecord record)
    {
        try
        {
            var config = TryLoadConfig();
            if (config is null)
            {
                return AttendanceSyncAttemptResult.Failed("backend config unavailable");
            }

            var endpoint = new Uri(config.ApiBaseUrl, "/api/agent/attendance");
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = JsonContent.Create(new
                {
                    user_name = record.UserName,
                    employee_no = record.EmployeeNoOrFallback,
                    machine_name = record.MachineName,
                    event_type = record.EventType,
                    occurred_at = record.OccurredAt,
                    source = "launcher"
                })
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiToken);

            using var response = await _httpClient.SendAsync(request);
            return response.IsSuccessStatusCode
                ? AttendanceSyncAttemptResult.Synced()
                : AttendanceSyncAttemptResult.Failed($"backend rejected {(int)response.StatusCode}");
        }
        catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException or JsonException)
        {
            return AttendanceSyncAttemptResult.Failed($"{ex.GetType().Name}: {ex.Message}");
        }
    }

    private static LauncherBackendConfig? TryLoadConfig()
    {
        return LauncherBackendConfigLoader.TryLoad();
    }
}

internal sealed record AttendanceSyncAttemptResult(bool IsSynced, string Message)
{
    public static AttendanceSyncAttemptResult Synced()
    {
        return new AttendanceSyncAttemptResult(true, "synced");
    }

    public static AttendanceSyncAttemptResult Failed(string message)
    {
        return new AttendanceSyncAttemptResult(false, message);
    }
}
