using System.Security.Cryptography;

namespace EmployeeBehavior.Agent.Service.Configuration;

internal static class ProtectedTokenCommand
{
    public static bool TryExecute(string[] args, out int exitCode)
    {
        exitCode = 0;
        if (!args.Contains("--write-protected-token", StringComparer.OrdinalIgnoreCase))
        {
            return false;
        }

        try
        {
            var token = GetRequiredValue(args, "--token");
            var path = GetRequiredValue(args, "--path");
            var scopeValue = GetOptionalValue(args, "--scope") ?? nameof(DataProtectionScope.LocalMachine);
            if (!Enum.TryParse<DataProtectionScope>(scopeValue, ignoreCase: true, out var scope))
            {
                throw new InvalidOperationException(
                    $"Invalid scope '{scopeValue}'. Allowed values: {nameof(DataProtectionScope.LocalMachine)}, {nameof(DataProtectionScope.CurrentUser)}.");
            }

            ProtectedTokenStore.WriteToken(path, token, scope);
            Console.WriteLine($"Protected token written to {Path.GetFullPath(Environment.ExpandEnvironmentVariables(path))} ({scope}).");
        }
        catch (Exception ex) when (ex is InvalidOperationException or CryptographicException or IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine(ex.Message);
            exitCode = 1;
        }

        return true;
    }

    private static string GetRequiredValue(string[] args, string name)
    {
        return GetOptionalValue(args, name)
            ?? throw new InvalidOperationException($"Missing required argument '{name}'.");
    }

    private static string? GetOptionalValue(string[] args, string name)
    {
        for (var index = 0; index < args.Length - 1; index++)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }

        return null;
    }
}
