using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed class EmployeeProfileResolver
{
    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(5)
    };

    public async Task<EmployeeProfile> ResolveAsync(string employeeCode)
    {
        var normalizedCode = employeeCode.Trim();
        var config = LauncherBackendConfigLoader.TryLoad();
        if (config is null)
        {
            return EmployeeProfile.LocalFallback(normalizedCode, "backend config unavailable");
        }

        try
        {
            var resolved = await TryResolveEmployeeAsync(config, normalizedCode);
            var ruleSummary = await TryLoadAttendanceRuleSummaryAsync(config, normalizedCode)
                              ?? await TryLoadPolicySummaryAsync(config);

            if (resolved is not null)
            {
                return resolved with
                {
                    RuleSummary = ChooseRuleSummary(resolved.RuleSummary, ruleSummary),
                    Source = "backend"
                };
            }

            return EmployeeProfile.LocalFallback(
                normalizedCode,
                "employee resolver unavailable",
                ruleSummary);
        }
        catch (Exception ex) when (
            ex is IOException or HttpRequestException or JsonException or InvalidOperationException or TaskCanceledException)
        {
            return EmployeeProfile.LocalFallback(normalizedCode, $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    private async Task<EmployeeProfile?> TryResolveEmployeeAsync(LauncherBackendConfig config, string employeeCode)
    {
        foreach (var endpoint in BuildResolveGetEndpoints(config.ApiBaseUrl, employeeCode))
        {
            var response = await SendAsync(config, new HttpRequestMessage(HttpMethod.Get, endpoint));
            if (response is null)
            {
                continue;
            }

            using (response)
            {
                if (ShouldTryNextEndpoint(response.StatusCode))
                {
                    continue;
                }

                if (!response.IsSuccessStatusCode)
                {
                    return null;
                }

                return ParseEmployeeProfile(await response.Content.ReadAsStringAsync(), employeeCode);
            }
        }

        var postEndpoint = new Uri(config.ApiBaseUrl, "/api/agent/employee/resolve");
        using var request = new HttpRequestMessage(HttpMethod.Post, postEndpoint)
        {
            Content = JsonContent.Create(new
            {
                employee_no = employeeCode,
                machine_name = Environment.MachineName
            })
        };
        var postResponse = await SendAsync(config, request);
        if (postResponse is null)
        {
            return null;
        }

        using (postResponse)
        {
            return postResponse.IsSuccessStatusCode
                ? ParseEmployeeProfile(await postResponse.Content.ReadAsStringAsync(), employeeCode)
                : null;
        }
    }

    private async Task<string?> TryLoadPolicySummaryAsync(LauncherBackendConfig config)
    {
        var response = await SendAsync(config, new HttpRequestMessage(HttpMethod.Get, new Uri(config.ApiBaseUrl, "/api/agent/policy")));
        if (response is null)
        {
            return null;
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var root = JsonNode.Parse(await response.Content.ReadAsStringAsync());
            var version = ReadString(root, "version");
            var interval = ReadInt(root, "screenshot_interval_seconds");
            var threshold = ReadInt(root, "no_change_threshold");
            var retention = ReadInt(root, "retention_days");

            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(version))
            {
                parts.Add($"policy {version}");
            }

            if (interval is not null)
            {
                parts.Add($"screenshot {interval}s");
            }

            if (threshold is not null)
            {
                parts.Add($"no-change threshold {threshold}");
            }

            if (retention is not null)
            {
                parts.Add($"retention {retention}d");
            }

            return parts.Count > 0 ? string.Join("; ", parts) : null;
        }
    }

    private async Task<string?> TryLoadAttendanceRuleSummaryAsync(LauncherBackendConfig config, string employeeCode)
    {
        var query = $"employee_no={Uri.EscapeDataString(employeeCode)}";
        var response = await SendAsync(
            config,
            new HttpRequestMessage(HttpMethod.Get, new Uri(config.ApiBaseUrl, $"/api/agent/attendance/rules?{query}")));
        if (response is null)
        {
            return null;
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var root = JsonNode.Parse(await response.Content.ReadAsStringAsync());
            var lateAfter = FirstNonBlank(ReadString(root, "clock_in_late_after"), "09:30");
            var earlyBefore = FirstNonBlank(ReadString(root, "clock_out_early_before"), "18:00");
            return $"late after {lateAfter}; early leave before {earlyBefore}";
        }
    }

    private async Task<HttpResponseMessage?> SendAsync(LauncherBackendConfig config, HttpRequestMessage request)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiToken);
        return await _httpClient.SendAsync(request);
    }

    private static IEnumerable<Uri> BuildResolveGetEndpoints(Uri apiBaseUrl, string employeeCode)
    {
        var query =
            $"employee_no={Uri.EscapeDataString(employeeCode)}&machine_name={Uri.EscapeDataString(Environment.MachineName)}";
        yield return new Uri(apiBaseUrl, $"/api/agent/employees/resolve?{query}");
        yield return new Uri(apiBaseUrl, $"/api/agent/employee/resolve?{query}");
        yield return new Uri(apiBaseUrl, $"/api/agent/attendance/profile?{query}");
    }

    private static bool ShouldTryNextEndpoint(HttpStatusCode statusCode)
    {
        return statusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed;
    }

    private static EmployeeProfile? ParseEmployeeProfile(string json, string fallbackEmployeeNo)
    {
        var root = JsonNode.Parse(json);
        var employeeNode = root?["employee"] ?? root?["data"] ?? root;
        if (employeeNode is null)
        {
            return null;
        }

        var employeeNo = FirstNonBlank(
            ReadString(employeeNode, "employee_no"),
            ReadString(employeeNode, "employeeNo"),
            ReadString(employeeNode, "code"),
            fallbackEmployeeNo);
        var displayName = FirstNonBlank(
            ReadString(employeeNode, "employee_name"),
            ReadString(employeeNode, "employeeName"),
            ReadString(employeeNode, "name"),
            ReadString(employeeNode, "user_name"),
            employeeNo);
        var department = FirstNonBlank(
            ReadString(employeeNode, "department"),
            ReadString(employeeNode, "department_name"));
        var ruleSummary = FirstNonBlank(
            ReadString(root, "rule_summary"),
            ReadString(root, "ruleSummary"),
            ReadString(root, "policy_summary"),
            ReadString(root, "policySummary"),
            ReadString(employeeNode, "rule_summary"),
            ReadString(employeeNode, "policy_summary"),
            SummarizeObject(root?["rules"] ?? root?["attendance_rules"] ?? root?["policy"] ?? employeeNode["policy"]));

        return new EmployeeProfile(
            EmployeeNo: employeeNo,
            DisplayName: displayName,
            Department: department,
            RuleSummary: ruleSummary,
            Source: "backend",
            Message: "employee resolved by backend");
    }

    private static string? SummarizeObject(JsonNode? node)
    {
        if (node is null)
        {
            return null;
        }

        var version = FirstNonBlank(ReadString(node, "version"), ReadString(node, "policy_version"));
        var clockIn = FirstNonBlank(ReadString(node, "clock_in_deadline"), ReadString(node, "late_after"), "09:30");
        var clockOut = FirstNonBlank(ReadString(node, "clock_out_earliest"), ReadString(node, "early_leave_before"), "18:00");
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(version))
        {
            parts.Add($"policy {version}");
        }

        parts.Add($"late after {clockIn}");
        parts.Add($"early leave before {clockOut}");
        return string.Join("; ", parts);
    }

    private static string? ChooseRuleSummary(string? preferred, string? fallback)
    {
        return !string.IsNullOrWhiteSpace(preferred) ? preferred : fallback;
    }

    private static string? ReadString(JsonNode? node, string propertyName)
    {
        var value = node?[propertyName];
        if (value is null)
        {
            return null;
        }

        try
        {
            return value.GetValue<string>();
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static int? ReadInt(JsonNode? node, string propertyName)
    {
        var value = node?[propertyName];
        if (value is null)
        {
            return null;
        }

        try
        {
            return value.GetValue<int>();
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static string FirstNonBlank(params string?[] values)
    {
        return values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;
    }
}

internal sealed record EmployeeProfile(
    string EmployeeNo,
    string DisplayName,
    string? Department,
    string? RuleSummary,
    string Source,
    string Message)
{
    public static EmployeeProfile LocalFallback(string employeeCode, string message, string? ruleSummary = null)
    {
        return new EmployeeProfile(
            EmployeeNo: employeeCode,
            DisplayName: employeeCode,
            Department: null,
            RuleSummary: ruleSummary ?? "local fallback: late after 09:30; early leave before 18:00",
            Source: "local fallback",
            Message: message);
    }
}
