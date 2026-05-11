using System.Security.AccessControl;
using System.Security.Principal;

namespace EmployeeBehavior.Agent.Service.Infrastructure;

public static class LocalFileProtection
{
    public static void EnsureProtectedDirectory(string? directoryPath)
    {
        if (string.IsNullOrWhiteSpace(directoryPath))
        {
            return;
        }

        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("The agent requires Windows ACL support for local state.");
        }

        Directory.CreateDirectory(directoryPath);
        new DirectoryInfo(directoryPath).SetAccessControl(CreateDirectorySecurity());
    }

    public static void ProtectFileOrThrow(string path, string purpose)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException($"The agent requires Windows EFS support for {purpose}.");
        }

        try
        {
            File.Encrypt(path);
            new FileInfo(path).SetAccessControl(CreateFileSecurity());
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            throw new InvalidOperationException(
                $"{purpose} file '{path}' could not be protected by Windows EFS/ACL. Configure an encrypted local path or fix service permissions before live capture.",
                ex);
        }
    }

    private static DirectorySecurity CreateDirectorySecurity()
    {
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        AddDirectoryRule(security, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null));
        AddDirectoryRule(security, new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        return security;
    }

    private static FileSecurity CreateFileSecurity()
    {
        var security = new FileSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        AddFileRule(security, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null));
        AddFileRule(security, new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        return security;
    }

    private static void AddDirectoryRule(DirectorySecurity security, SecurityIdentifier identity)
    {
        security.AddAccessRule(
            new FileSystemAccessRule(
                identity,
                FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None,
                AccessControlType.Allow));
    }

    private static void AddFileRule(FileSecurity security, SecurityIdentifier identity)
    {
        security.AddAccessRule(
            new FileSystemAccessRule(
                identity,
                FileSystemRights.FullControl,
                AccessControlType.Allow));
    }
}
