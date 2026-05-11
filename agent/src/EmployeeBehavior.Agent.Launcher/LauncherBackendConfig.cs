using System.Text.Json;
using System.Text.Json.Nodes;

namespace EmployeeBehavior.Agent.Launcher;

internal sealed record LauncherBackendConfig(Uri ApiBaseUrl, string ApiToken);

internal static class LauncherBackendConfigLoader
{
    public static LauncherBackendConfig? TryLoad()
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
            var apiToken = service?["ApiToken"]?.GetValue<string>()?.Trim();

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

            // Launcher forwards already issued scoped bearer tokens as-is. It does
            // not derive a per-device token from a raw signing secret.
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
