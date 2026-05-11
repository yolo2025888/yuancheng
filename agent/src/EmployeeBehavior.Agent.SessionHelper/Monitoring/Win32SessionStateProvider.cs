using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.SessionHelper.Configuration;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.SessionHelper.Monitoring;

public sealed class Win32SessionStateProvider : ISessionStateProvider
{
    private const int SM_REMOTESESSION = 0x1000;
    private const int UOI_NAME = 2;
    private const uint DESKTOP_READOBJECTS = 0x0001;
    private const uint DESKTOP_SWITCHDESKTOP = 0x0100;

    private readonly SessionHelperOptions _options;

    public Win32SessionStateProvider(IOptions<SessionHelperOptions> options)
    {
        _options = options.Value;
    }

    public Task<SessionStateSnapshot> GetCurrentAsync(CancellationToken cancellationToken)
    {
        var sessionId = Process.GetCurrentProcess().SessionId;
        var activeConsoleSessionId = unchecked((int)WTSGetActiveConsoleSessionId());
        var stateValue = WtsConnectStateClass.WTSDown;
        var connectState = TryQuerySessionState(sessionId, out stateValue)
            ? stateValue.ToString()
            : string.Empty;
        var isActiveSession = stateValue == WtsConnectStateClass.WTSActive;

        var protocolType = TryQueryProtocolType(sessionId, out var protocolValue)
            ? protocolValue
            : (ushort)0;
        var isRdpSession = protocolType == 2;
        var isRemoteSession = GetSystemMetrics(SM_REMOTESESSION) != 0 || isRdpSession;

        var idleSeconds = TryGetIdleSeconds(out var idleValue)
            ? idleValue
            : 0;
        var inputDesktopName = _options.EnableDesktopStateInspection && TryGetInputDesktopName(out var desktopName)
            ? desktopName
            : string.Empty;

        var isLocked = DetermineLockedState(isActiveSession, inputDesktopName);
        var detail = BuildStatusDetail(connectState, inputDesktopName, idleSeconds, isRemoteSession, isRdpSession);

        return Task.FromResult(new SessionStateSnapshot
        {
            CollectedAtUtc = DateTimeOffset.UtcNow,
            SessionId = sessionId,
            UserName = BuildUserName(),
            IsLocked = isLocked,
            IsRemoteSession = isRemoteSession,
            IsRdpSession = isRdpSession,
            IsActiveSession = isActiveSession,
            IsConsoleSession = sessionId == activeConsoleSessionId,
            ActiveConsoleSessionId = activeConsoleSessionId,
            IdleSeconds = idleSeconds,
            InputDesktopName = inputDesktopName,
            SessionConnectState = connectState,
            StatusDetail = detail
        });
    }

    private static string BuildUserName()
    {
        return string.IsNullOrWhiteSpace(Environment.UserDomainName)
            ? Environment.UserName
            : $"{Environment.UserDomainName}\\{Environment.UserName}";
    }

    private static bool DetermineLockedState(bool isActiveSession, string inputDesktopName)
    {
        if (!isActiveSession)
        {
            return false;
        }

        return !string.IsNullOrWhiteSpace(inputDesktopName)
               && !string.Equals(inputDesktopName, "Default", StringComparison.OrdinalIgnoreCase);
    }

    private static string BuildStatusDetail(
        string connectState,
        string inputDesktopName,
        int idleSeconds,
        bool isRemoteSession,
        bool isRdpSession)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(connectState))
        {
            parts.Add($"wts={connectState}");
        }

        if (!string.IsNullOrWhiteSpace(inputDesktopName))
        {
            parts.Add($"desktop={inputDesktopName}");
        }

        parts.Add($"idle={idleSeconds}s");

        if (isRdpSession)
        {
            parts.Add("protocol=rdp");
        }
        else if (isRemoteSession)
        {
            parts.Add("protocol=remote");
        }
        else
        {
            parts.Add("protocol=local");
        }

        return string.Join("; ", parts);
    }

    private static bool TryGetIdleSeconds(out int idleSeconds)
    {
        var info = new LASTINPUTINFO
        {
            cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>()
        };

        if (!GetLastInputInfo(ref info))
        {
            idleSeconds = 0;
            return false;
        }

        var idleMilliseconds = GetTickCount() - info.dwTime;
        idleSeconds = (int)Math.Min(idleMilliseconds / 1000, int.MaxValue);
        return true;
    }

    private static bool TryGetInputDesktopName(out string desktopName)
    {
        desktopName = string.Empty;

        var desktopHandle = OpenInputDesktop(0, false, DESKTOP_READOBJECTS | DESKTOP_SWITCHDESKTOP);
        if (desktopHandle == IntPtr.Zero)
        {
            return false;
        }

        try
        {
            var lengthNeeded = 0;
            _ = GetUserObjectInformation(desktopHandle, UOI_NAME, null, 0, ref lengthNeeded);
            if (lengthNeeded <= 0)
            {
                return false;
            }

            var capacity = Math.Max(64, (lengthNeeded / sizeof(char)) + 1);
            var nameBuilder = new StringBuilder(capacity);
            if (!GetUserObjectInformation(desktopHandle, UOI_NAME, nameBuilder, lengthNeeded, ref lengthNeeded))
            {
                return false;
            }

            desktopName = nameBuilder.ToString().TrimEnd('\0');
            return !string.IsNullOrWhiteSpace(desktopName);
        }
        finally
        {
            _ = CloseDesktop(desktopHandle);
        }
    }

    private static bool TryQuerySessionState(int sessionId, out WtsConnectStateClass state)
    {
        state = WtsConnectStateClass.WTSDown;
        if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, WtsInfoClass.WTSConnectState, out var buffer, out var returnedBytes))
        {
            return false;
        }

        try
        {
            if (returnedBytes < sizeof(int))
            {
                return false;
            }

            state = (WtsConnectStateClass)Marshal.ReadInt32(buffer);
            return true;
        }
        finally
        {
            WTSFreeMemory(buffer);
        }
    }

    private static bool TryQueryProtocolType(int sessionId, out ushort protocolType)
    {
        protocolType = 0;
        if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, WtsInfoClass.WTSClientProtocolType, out var buffer, out var returnedBytes))
        {
            return false;
        }

        try
        {
            if (returnedBytes < sizeof(short))
            {
                return false;
            }

            protocolType = (ushort)Marshal.ReadInt16(buffer);
            return true;
        }
        finally
        {
            WTSFreeMemory(buffer);
        }
    }

    private enum WtsInfoClass
    {
        WTSInitialProgram,
        WTSApplicationName,
        WTSWorkingDirectory,
        WTSOEMId,
        WTSSessionId,
        WTSUserName,
        WTSWinStationName,
        WTSDomainName,
        WTSConnectState,
        WTSClientBuildNumber,
        WTSClientName,
        WTSClientDirectory,
        WTSClientProductId,
        WTSClientHardwareId,
        WTSClientAddress,
        WTSClientDisplay,
        WTSClientProtocolType
    }

    private enum WtsConnectStateClass
    {
        WTSActive,
        WTSConnected,
        WTSConnectQuery,
        WTSShadow,
        WTSDisconnected,
        WTSIdle,
        WTSListen,
        WTSReset,
        WTSDown,
        WTSInit
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [DllImport("kernel32.dll")]
    private static extern uint GetTickCount();

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQuerySessionInformation(
        IntPtr hServer,
        int sessionId,
        WtsInfoClass wtsInfoClass,
        out IntPtr ppBuffer,
        out int pBytesReturned);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr pointer);

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool GetUserObjectInformation(
        IntPtr hObj,
        int nIndex,
        StringBuilder? pvInfo,
        int nLength,
        ref int lpnLengthNeeded);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr hDesktop);
}
