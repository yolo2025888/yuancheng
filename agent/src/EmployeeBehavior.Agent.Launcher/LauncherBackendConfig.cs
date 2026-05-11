using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text;

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
            var protectedTokenPath = service?["ProtectedTokenPath"]?.GetValue<string>()?.Trim();
            var apiToken = ResolveToken(serviceSettingsPath, protectedTokenPath, service?["ApiToken"]?.GetValue<string>());

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
        catch (Exception ex) when (ex is IOException or JsonException or InvalidOperationException or CryptographicException or FormatException)
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

    private static string? ResolveToken(string serviceSettingsPath, string? protectedTokenPath, string? fallbackToken)
    {
        var normalizedFallback = NormalizeToken(fallbackToken);
        if (string.IsNullOrWhiteSpace(protectedTokenPath))
        {
            return normalizedFallback;
        }

        var candidatePath = Environment.ExpandEnvironmentVariables(protectedTokenPath);
        if (!Path.IsPathRooted(candidatePath))
        {
            candidatePath = Path.Combine(Path.GetDirectoryName(serviceSettingsPath) ?? AppContext.BaseDirectory, candidatePath);
        }

        var resolvedPath = Path.GetFullPath(candidatePath);
        if (!File.Exists(resolvedPath))
        {
            return normalizedFallback;
        }

        return NormalizeToken(ReadProtectedToken(resolvedPath)) ?? normalizedFallback;
    }

    private static string ReadProtectedToken(string path)
    {
        var payload = JsonSerializer.Deserialize<ProtectedTokenPayload>(
            File.ReadAllText(path, Encoding.UTF8),
            SerializerOptions)
            ?? throw new InvalidOperationException($"Protected token file '{path}' is empty.");

        if (!string.Equals(payload.Format, "dpapi/v1", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Protected token file '{path}' uses unsupported format '{payload.Format ?? "<null>"}'.");
        }

        if (string.IsNullOrWhiteSpace(payload.Scope) ||
            !Enum.TryParse<DataProtectionScope>(payload.Scope, ignoreCase: true, out var scope))
        {
            throw new InvalidOperationException(
                $"Protected token file '{path}' has invalid DPAPI scope '{payload.Scope ?? "<null>"}'.");
        }

        if (string.IsNullOrWhiteSpace(payload.ProtectedToken))
        {
            throw new InvalidOperationException($"Protected token file '{path}' does not contain token data.");
        }

        try
        {
            var protectedBytes = Convert.FromBase64String(payload.ProtectedToken);
            var tokenBytes = ProtectedData.Unprotect(protectedBytes, optionalEntropy: null, scope);
            return Encoding.UTF8.GetString(tokenBytes);
        }
        catch (FormatException ex)
        {
            throw new InvalidOperationException(
                $"Protected token file '{path}' does not contain valid base64 token data.",
                ex);
        }
        catch (CryptographicException ex)
        {
            throw new InvalidOperationException(
                $"Failed to decrypt protected token file '{path}' with scope '{scope}'.",
                ex);
        }
    }

    private static string? NormalizeToken(string? token)
    {
        var normalized = token?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private sealed class ProtectedTokenPayload
    {
        public string? Format { get; set; }

        public string? Scope { get; set; }

        public string? ProtectedToken { get; set; }
    }
}
