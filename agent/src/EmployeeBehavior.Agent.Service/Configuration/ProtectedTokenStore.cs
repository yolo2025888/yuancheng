using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace EmployeeBehavior.Agent.Service.Configuration;

internal static class ProtectedTokenStore
{
    public static void WriteToken(string path, string token, DataProtectionScope scope)
    {
        var resolvedPath = ResolvePath(path);
        var directory = Path.GetDirectoryName(resolvedPath);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new InvalidOperationException($"Protected token path '{resolvedPath}' does not have a parent directory.");
        }

        Directory.CreateDirectory(directory);

        var normalizedToken = NormalizeToken(token)
            ?? throw new InvalidOperationException("Token must not be empty.");
        if (!normalizedToken.StartsWith("v2:", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Token must be an issued device-scoped v2:<device_id>:<secret> token.");
        }

        var tokenBytes = Encoding.UTF8.GetBytes(normalizedToken);
        var protectedBytes = ProtectedData.Protect(tokenBytes, optionalEntropy: null, scope);
        var payload = new ProtectedTokenPayload
        {
            Format = "dpapi/v1",
            Scope = scope.ToString(),
            ProtectedToken = Convert.ToBase64String(protectedBytes)
        };

        File.WriteAllText(resolvedPath, JsonSerializer.Serialize(payload, SerializerOptions), Encoding.UTF8);
    }

    public static string? ResolveToken(
        string? protectedTokenPath,
        string? fallbackToken,
        ILogger? logger = null)
    {
        var normalizedFallback = NormalizeToken(fallbackToken);
        if (string.IsNullOrWhiteSpace(protectedTokenPath))
        {
            return normalizedFallback;
        }

        var resolvedPath = ResolvePath(protectedTokenPath);
        if (!File.Exists(resolvedPath))
        {
            logger?.LogWarning(
                "Protected agent token file not found at {ProtectedTokenPath}. Falling back to configured ApiToken.",
                resolvedPath);
            return normalizedFallback;
        }

        var protectedToken = ReadToken(resolvedPath);
        logger?.LogInformation("Loaded API token from protected file {ProtectedTokenPath}.", resolvedPath);
        return NormalizeToken(protectedToken) ?? normalizedFallback;
    }

    public static string ReadToken(string path)
    {
        var resolvedPath = ResolvePath(path);
        var payload = JsonSerializer.Deserialize<ProtectedTokenPayload>(
            File.ReadAllText(resolvedPath, Encoding.UTF8),
            SerializerOptions)
            ?? throw new InvalidOperationException($"Protected token file '{resolvedPath}' is empty.");

        if (!string.Equals(payload.Format, "dpapi/v1", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Protected token file '{resolvedPath}' uses unsupported format '{payload.Format ?? "<null>"}'.");
        }

        if (string.IsNullOrWhiteSpace(payload.Scope) ||
            !Enum.TryParse<DataProtectionScope>(payload.Scope, ignoreCase: true, out var scope))
        {
            throw new InvalidOperationException(
                $"Protected token file '{resolvedPath}' has invalid DPAPI scope '{payload.Scope ?? "<null>"}'.");
        }

        if (string.IsNullOrWhiteSpace(payload.ProtectedToken))
        {
            throw new InvalidOperationException($"Protected token file '{resolvedPath}' does not contain token data.");
        }

        byte[] protectedBytes;
        try
        {
            protectedBytes = Convert.FromBase64String(payload.ProtectedToken);
        }
        catch (FormatException ex)
        {
            throw new InvalidOperationException(
                $"Protected token file '{resolvedPath}' does not contain valid base64 token data.",
                ex);
        }

        try
        {
            var tokenBytes = ProtectedData.Unprotect(protectedBytes, optionalEntropy: null, scope);
            return Encoding.UTF8.GetString(tokenBytes);
        }
        catch (CryptographicException ex)
        {
            throw new InvalidOperationException(
                $"Failed to decrypt protected token file '{resolvedPath}' with scope '{scope}'.",
                ex);
        }
    }

    private static string ResolvePath(string path)
    {
        return Path.GetFullPath(Environment.ExpandEnvironmentVariables(path));
    }

    private static string? NormalizeToken(string? token)
    {
        var normalized = token?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private sealed class ProtectedTokenPayload
    {
        public string? Format { get; set; }

        public string? Scope { get; set; }

        public string? ProtectedToken { get; set; }
    }
}
