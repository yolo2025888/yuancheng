using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed class AttendanceReporter
{
    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(5)
    };

    public async Task<string> TryReportAsync(string eventType, string employeeCode, DateTimeOffset occurredAt)
    {
        try
        {
            var config = TryLoadConfig();
            if (config is null)
            {
                return "Local only";
            }

            var endpoint = new Uri(config.ApiBaseUrl, "/api/agent/attendance");
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = JsonContent.Create(new
                {
                    user_name = employeeCode,
                    employee_no = employeeCode,
                    machine_name = Environment.MachineName,
                    event_type = eventType,
                    occurred_at = occurredAt,
                    source = "launcher"
                })
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiToken);

            using var response = await _httpClient.SendAsync(request);
            return response.IsSuccessStatusCode
                ? "Synced"
                : $"Local saved, backend rejected {(int)response.StatusCode}";
        }
        catch (Exception ex) when (ex is IOException or HttpRequestException or TaskCanceledException or JsonException)
        {
            return $"Local saved, sync failed: {ex.GetType().Name}";
        }
    }

    private static LauncherBackendConfig? TryLoadConfig()
    {
        try
        {
            var serviceSettingsPath = ResolveServiceSettingsPath();
            if (serviceSettingsPath is null)
            {
                return null;
            }

            var root = JsonNode.Parse(File.ReadAllText(serviceSettingsPath))?.AsObject();
            var service = root?["AgentService"]?.AsObject();
            var apiBaseUrlValue = service?["ApiBaseUrl"]?.GetValue<string>();
            var apiToken = service?["ApiToken"]?.GetValue<string>();

            if (!Uri.TryCreate(apiBaseUrlValue, UriKind.Absolute, out var apiBaseUrl))
            {
                return null;
            }

            if (apiBaseUrl.Host.Contains("example", StringComparison.OrdinalIgnoreCase) ||
                string.IsNullOrWhiteSpace(apiToken) ||
                apiToken.Contains("replace-with", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            return new LauncherBackendConfig(apiBaseUrl, apiToken);
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidOperationException)
        {
            return null;
        }
    }

    private static string? ResolveServiceSettingsPath()
    {
        var baseDirectory = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDirectory, "Service", "appsettings.json"),
            Path.Combine(baseDirectory, "..", "Service", "appsettings.json"),
            Path.Combine(baseDirectory, "Service", "appsettings.json.example"),
            Path.Combine(baseDirectory, "..", "Service", "appsettings.json.example")
        };

        return candidates.Select(Path.GetFullPath).FirstOrDefault(File.Exists);
    }
}

internal sealed record LauncherBackendConfig(Uri ApiBaseUrl, string ApiToken);
