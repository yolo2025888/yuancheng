using System.Net;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.Service.Configuration;

internal sealed class AgentServiceOptionsValidator : IValidateOptions<AgentServiceOptions>
{
    public ValidateOptionsResult Validate(string? name, AgentServiceOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (options.DryRun)
        {
            return ValidateOptionsResult.Success;
        }

        var failures = new List<string>();
        ValidateApiBaseUrl(options.ApiBaseUrl, failures);
        ValidateAuthentication(options.ProtectedTokenPath, options.ApiToken, failures);

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }

    private static void ValidateApiBaseUrl(string? apiBaseUrl, List<string> failures)
    {
        var normalizedApiBaseUrl = apiBaseUrl?.Trim();
        if (!Uri.TryCreate(normalizedApiBaseUrl, UriKind.Absolute, out var apiUri))
        {
            failures.Add("AgentService.ApiBaseUrl must be a valid absolute URI when DryRun=false.");
            return;
        }

        if (!string.Equals(apiUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            failures.Add("AgentService.ApiBaseUrl must use HTTPS when DryRun=false.");
        }

        if (IsUnsafeProductionHost(apiUri.Host))
        {
            failures.Add(
                $"AgentService.ApiBaseUrl host '{apiUri.Host}' is not allowed when DryRun=false. Use a production HTTPS backend instead of localhost or reserved example hosts.");
        }
    }

    private static void ValidateAuthentication(string? protectedTokenPath, string? apiToken, List<string> failures)
    {
        var normalizedProtectedTokenPath = protectedTokenPath?.Trim();
        var normalizedApiToken = apiToken?.Trim();
        var hasProtectedTokenPath = !string.IsNullOrWhiteSpace(normalizedProtectedTokenPath);
        var hasApiToken = !string.IsNullOrWhiteSpace(normalizedApiToken);
        var hasV2ApiToken = hasApiToken && normalizedApiToken!.StartsWith("v2:", StringComparison.OrdinalIgnoreCase);

        if (hasApiToken && !hasV2ApiToken)
        {
            failures.Add("AgentService.ApiToken must start with v2: when configured. Legacy v1 tokens and raw signing secrets are not allowed when DryRun=false.");
        }

        if (!hasProtectedTokenPath && !hasV2ApiToken)
        {
            failures.Add("AgentService.ProtectedTokenPath or a v2 AgentService.ApiToken is required when DryRun=false.");
        }
    }

    private static bool IsUnsafeProductionHost(string? hostName)
    {
        if (string.IsNullOrWhiteSpace(hostName))
        {
            return true;
        }

        var normalizedHost = hostName.Trim().ToLowerInvariant();
        return normalizedHost == "localhost" ||
               normalizedHost == "127.0.0.1" ||
               normalizedHost == "::1" ||
               IPAddress.TryParse(normalizedHost, out var ipAddress) && IPAddress.IsLoopback(ipAddress) ||
               normalizedHost.EndsWith(".local", StringComparison.Ordinal) ||
               normalizedHost.EndsWith(".example", StringComparison.Ordinal) ||
               normalizedHost.EndsWith(".test", StringComparison.Ordinal) ||
               normalizedHost.EndsWith(".invalid", StringComparison.Ordinal) ||
               normalizedHost == "example.com" ||
               normalizedHost.EndsWith(".example.com", StringComparison.Ordinal) ||
               normalizedHost == "example.net" ||
               normalizedHost.EndsWith(".example.net", StringComparison.Ordinal) ||
               normalizedHost == "example.org" ||
               normalizedHost.EndsWith(".example.org", StringComparison.Ordinal) ||
               normalizedHost.Contains("example.internal", StringComparison.Ordinal) ||
               normalizedHost.Contains("replace-", StringComparison.Ordinal);
    }
}
