using System.Diagnostics;
using System.Runtime.InteropServices;
using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.SessionHelper.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.SessionHelper.Monitoring;

public sealed class Win32InputActivityCounter : IInputActivityCounter, IHostedService, IDisposable
{
    private const uint WINEVENT_OUTOFCONTEXT = 0;
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MOUSEWHEEL = 0x020A;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const uint WM_QUIT = 0x0012;

    private readonly object _lifecycleGate = new();
    private readonly ILogger<Win32InputActivityCounter> _logger;
    private readonly SessionHelperOptions _options;
    private readonly HookProc _keyboardHookProc;
    private readonly HookProc _mouseHookProc;
    private readonly WinEventDelegate _foregroundHookProc;
    private DateTimeOffset _lastCollectedAtUtc = DateTimeOffset.UtcNow;
    private Thread? _hookThread;
    private IntPtr _keyboardHookHandle;
    private IntPtr _mouseHookHandle;
    private IntPtr _foregroundHookHandle;
    private uint _hookThreadId;
    private long _keyboardEventCount;
    private long _mouseMoveCount;
    private long _mouseClickCount;
    private long _mouseWheelCount;
    private long _windowSwitchCount;
    private Exception? _startupException;
    private readonly ManualResetEventSlim _startupSignal = new(false);

    public Win32InputActivityCounter(
        IOptions<SessionHelperOptions> options,
        ILogger<Win32InputActivityCounter> logger)
    {
        _logger = logger;
        _options = options.Value;
        _keyboardHookProc = KeyboardHookCallback;
        _mouseHookProc = MouseHookCallback;
        _foregroundHookProc = ForegroundChangedCallback;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_options.EnableInputActivityHooks)
        {
            _logger.LogInformation("Input activity hooks are disabled by configuration.");
            return Task.CompletedTask;
        }

        lock (_lifecycleGate)
        {
            if (_hookThread is not null)
            {
                return Task.CompletedTask;
            }

            _startupException = null;
            _startupSignal.Reset();
            _hookThread = new Thread(HookThreadMain)
            {
                IsBackground = true,
                Name = "SessionHelperInputHooks"
            };
            _hookThread.SetApartmentState(ApartmentState.STA);
            _hookThread.Start();
        }

        var timeoutSeconds = Math.Max(1, _options.InputHookStartupTimeoutSeconds);
        if (!_startupSignal.Wait(TimeSpan.FromSeconds(timeoutSeconds), cancellationToken))
        {
            _logger.LogWarning(
                "Timed out waiting for input activity hooks to start after {TimeoutSeconds}s. Counts will remain zero until hooks recover.",
                timeoutSeconds);
            return Task.CompletedTask;
        }

        if (_startupException is not null)
        {
            _logger.LogWarning(
                _startupException,
                "Input activity hooks failed to start. Session helper will continue without keyboard/mouse counting.");
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        Thread? hookThread;

        lock (_lifecycleGate)
        {
            hookThread = _hookThread;
        }

        if (hookThread is null)
        {
            return Task.CompletedTask;
        }

        if (_hookThreadId != 0)
        {
            _ = PostThreadMessage(_hookThreadId, WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
        }

        if (!hookThread.Join(TimeSpan.FromSeconds(5)))
        {
            _logger.LogWarning("Input hook thread did not stop within the expected timeout.");
        }

        lock (_lifecycleGate)
        {
            _hookThread = null;
            _hookThreadId = 0;
        }

        return Task.CompletedTask;
    }

    public Task<InputActivitySnapshot> GetSnapshotAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var collectedFromUtc = _lastCollectedAtUtc;
        _lastCollectedAtUtc = now;

        var keyboardEventCount = Interlocked.Exchange(ref _keyboardEventCount, 0);
        var mouseMoveCount = Interlocked.Exchange(ref _mouseMoveCount, 0);
        var mouseClickCount = Interlocked.Exchange(ref _mouseClickCount, 0);
        var mouseWheelCount = Interlocked.Exchange(ref _mouseWheelCount, 0);
        var windowSwitchCount = Interlocked.Exchange(ref _windowSwitchCount, 0);

        return Task.FromResult(new InputActivitySnapshot
        {
            CollectedFromUtc = collectedFromUtc,
            CollectedToUtc = now,
            KeyboardEventCount = keyboardEventCount,
            MouseMoveCount = mouseMoveCount,
            MouseClickCount = mouseClickCount,
            MouseWheelCount = mouseWheelCount,
            MouseEventCount = mouseMoveCount + mouseClickCount + mouseWheelCount,
            WindowSwitchCount = windowSwitchCount
        });
    }

    public void Dispose()
    {
        _startupSignal.Dispose();
    }

    private void HookThreadMain()
    {
        _hookThreadId = GetCurrentThreadId();

        try
        {
            using var currentProcess = Process.GetCurrentProcess();
            using var currentModule = currentProcess.MainModule;
            var moduleHandle = currentModule is null
                ? IntPtr.Zero
                : GetModuleHandle(currentModule.ModuleName);

            _keyboardHookHandle = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardHookProc, moduleHandle, 0);
            _mouseHookHandle = SetWindowsHookEx(WH_MOUSE_LL, _mouseHookProc, moduleHandle, 0);
            _foregroundHookHandle = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero,
                _foregroundHookProc,
                0,
                0,
                WINEVENT_OUTOFCONTEXT);

            if (_keyboardHookHandle == IntPtr.Zero || _mouseHookHandle == IntPtr.Zero || _foregroundHookHandle == IntPtr.Zero)
            {
                throw new InvalidOperationException(
                    $"Unable to install all input hooks. keyboard={_keyboardHookHandle != IntPtr.Zero}, mouse={_mouseHookHandle != IntPtr.Zero}, foreground={_foregroundHookHandle != IntPtr.Zero}, lastError={Marshal.GetLastWin32Error()}");
            }
        }
        catch (Exception ex)
        {
            _startupException = ex;
            _startupSignal.Set();
            _logger.LogWarning(ex, "Input hook installation failed.");
            return;
        }

        _startupSignal.Set();
        _logger.LogInformation("Input activity hooks installed for the interactive session.");

        try
        {
            while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                _ = TranslateMessage(ref message);
                _ = DispatchMessage(ref message);
            }
        }
        finally
        {
            if (_foregroundHookHandle != IntPtr.Zero)
            {
                _ = UnhookWinEvent(_foregroundHookHandle);
                _foregroundHookHandle = IntPtr.Zero;
            }

            if (_mouseHookHandle != IntPtr.Zero)
            {
                _ = UnhookWindowsHookEx(_mouseHookHandle);
                _mouseHookHandle = IntPtr.Zero;
            }

            if (_keyboardHookHandle != IntPtr.Zero)
            {
                _ = UnhookWindowsHookEx(_keyboardHookHandle);
                _keyboardHookHandle = IntPtr.Zero;
            }
        }
    }

    private IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var message = unchecked((int)wParam.ToInt64());
            if (message is WM_KEYDOWN or WM_SYSKEYDOWN)
            {
                Interlocked.Increment(ref _keyboardEventCount);
            }
        }

        return CallNextHookEx(_keyboardHookHandle, nCode, wParam, lParam);
    }

    private IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var message = unchecked((int)wParam.ToInt64());
            switch (message)
            {
                case WM_MOUSEMOVE:
                    Interlocked.Increment(ref _mouseMoveCount);
                    break;
                case WM_LBUTTONDOWN:
                case WM_RBUTTONDOWN:
                case WM_MBUTTONDOWN:
                case WM_XBUTTONDOWN:
                    Interlocked.Increment(ref _mouseClickCount);
                    break;
                case WM_MOUSEWHEEL:
                    Interlocked.Increment(ref _mouseWheelCount);
                    break;
            }
        }

        return CallNextHookEx(_mouseHookHandle, nCode, wParam, lParam);
    }

    private void ForegroundChangedCallback(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint idEventThread,
        uint dwmsEventTime)
    {
        if (eventType == EVENT_SYSTEM_FOREGROUND && hwnd != IntPtr.Zero)
        {
            Interlocked.Increment(ref _windowSwitchCount);
        }
    }

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    private delegate void WinEventDelegate(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint idEventThread,
        uint dwmsEventTime);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
        public uint lPrivate;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWinEventHook(
        uint eventMin,
        uint eventMax,
        IntPtr hmodWinEventProc,
        WinEventDelegate lpfnWinEventProc,
        uint idProcess,
        uint idThread,
        uint dwFlags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostThreadMessage(uint idThread, uint msg, UIntPtr wParam, IntPtr lParam);
}
