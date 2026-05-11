using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using EmployeeBehavior.Agent.Contracts.Models;
using EmployeeBehavior.Agent.Service.Configuration;
using Microsoft.Extensions.Options;

namespace EmployeeBehavior.Agent.Service.Transport;

public sealed class AgentApiClient : IAgentApiClient
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<AgentApiClient> _logger;
    private readonly AgentServiceOptions _options;

    public AgentApiClient(
        HttpClient httpClient,
        IOptions<AgentServiceOptions> options,
        ILogger<AgentApiClient> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _options = options.Value;
    }

    public async Task<HeartbeatResponse> SendHeartbeatAsync(
        HeartbeatRequest request,
        CancellationToken cancellationToken)
    {
        if (_options.DryRun)
        {
            _logger.LogInformation("DryRun heartbeat to /api/agent/heartbeat for device {DeviceId}.", request.DeviceId);
            return new HeartbeatResponse
            {
                PolicyVersion = request.CurrentPolicyVersion,
                ServerTimeUtc = DateTimeOffset.UtcNow,
                NextHeartbeatInSeconds = _options.HeartbeatIntervalSeconds
            };
        }

        var backendRequest = new
        {
            device_id = request.DeviceId,
            employee_id = request.EmployeeId,
            hostname = request.Hostname,
            os_type = request.OsType,
            agent_version = request.AgentVersion,
            screen_count = request.ScreenCount,
            status = request.Status,
            session_state = request.SessionState is null ? null : new
            {
                collected_at = request.SessionState.CollectedAtUtc,
                session_id = request.SessionState.SessionId,
                user_name = request.SessionState.UserName,
                is_locked = request.SessionState.IsLocked,
                is_remote_session = request.SessionState.IsRemoteSession,
                is_rdp_session = request.SessionState.IsRdpSession,
                is_active_session = request.SessionState.IsActiveSession,
                is_console_session = request.SessionState.IsConsoleSession,
                active_console_session_id = request.SessionState.ActiveConsoleSessionId,
                idle_seconds = request.SessionState.IdleSeconds,
                input_desktop_name = request.SessionState.InputDesktopName,
                session_connect_state = request.SessionState.SessionConnectState,
                status_detail = request.SessionState.StatusDetail
            },
            foreground_window = request.ForegroundWindow is null ? null : new
            {
                collected_at = request.ForegroundWindow.CollectedAtUtc,
                process_name = request.ForegroundWindow.ProcessName,
                executable_path = request.ForegroundWindow.ExecutablePath,
                window_title = request.ForegroundWindow.WindowTitle
            },
            input_activity = request.InputActivity is null ? null : new
            {
                collected_from = request.InputActivity.CollectedFromUtc,
                collected_to = request.InputActivity.CollectedToUtc,
                keyboard_event_count = request.InputActivity.KeyboardEventCount,
                mouse_event_count = request.InputActivity.MouseEventCount,
                mouse_move_count = request.InputActivity.MouseMoveCount,
                mouse_click_count = request.InputActivity.MouseClickCount,
                mouse_wheel_count = request.InputActivity.MouseWheelCount,
                window_switch_count = request.InputActivity.WindowSwitchCount
            }
        };

        using var response = await _httpClient.PostAsJsonAsync(
            "/api/agent/heartbeat",
            backendRequest,
            cancellationToken);

        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;
        var policy = root.GetProperty("policy");

        return new HeartbeatResponse
        {
            ServerTimeUtc = root.TryGetProperty("server_time", out var serverTime)
                ? serverTime.GetDateTimeOffset()
                : DateTimeOffset.UtcNow,
            PolicyVersion = policy.TryGetProperty("version", out var version)
                ? version.GetString() ?? string.Empty
                : string.Empty,
            NextHeartbeatInSeconds = _options.HeartbeatIntervalSeconds
        };
    }

    public async Task<AgentPolicy> GetPolicyAsync(CancellationToken cancellationToken)
    {
        if (_options.DryRun)
        {
            _logger.LogInformation("DryRun policy fetch from /api/agent/policy.");
            return _options.DefaultPolicy ?? AgentPolicy.CreateDefault();
        }

        await using var stream = await _httpClient.GetStreamAsync("/api/agent/policy", cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;

        return new AgentPolicy
        {
            Version = root.TryGetProperty("version", out var version)
                ? version.GetString() ?? "default"
                : "default",
            CaptureEnabled = true,
            ScreenshotIntervalSeconds = root.TryGetProperty("screenshot_interval_seconds", out var interval)
                ? interval.GetInt32()
                : 10,
            NoChangeThreshold = root.TryGetProperty("no_change_threshold", out var threshold)
                ? threshold.GetInt32()
                : 6
        };
    }

    public async Task<ScreenshotUploadResponse> UploadScreenshotAsync(
        ScreenshotUploadRequest request,
        CancellationToken cancellationToken)
    {
        if (_options.DryRun)
        {
            _logger.LogInformation(
                "DryRun screenshot upload to /api/agent/screenshots for display {DisplayName}. ImageBytes={ImageBytes} ThumbBytes={ThumbnailBytes} Hash={Hash}.",
                request.DisplayName,
                request.ImageSizeBytes > 0 ? request.ImageSizeBytes : request.ImageBytes.LongLength,
                request.ThumbnailSizeBytes > 0 ? request.ThumbnailSizeBytes : request.ThumbnailBytes.LongLength,
                request.ImageSha256);

            return new ScreenshotUploadResponse
            {
                ScreenshotId = Guid.NewGuid().ToString("N"),
                Status = "accepted"
            };
        }

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(request.DeviceId), "device_id");
        form.Add(new StringContent(request.CapturedAtUtc.UtcDateTime.ToString("O")), "captured_at");
        form.Add(new StringContent(request.ScreenIndex.ToString()), "screen_index");
        form.Add(new StringContent(request.ImageWidth.ToString()), "width");
        form.Add(new StringContent(request.ImageHeight.ToString()), "height");
        form.Add(new StringContent(request.ForegroundWindow?.ProcessName ?? string.Empty), "foreground_process");
        form.Add(new StringContent(request.ForegroundWindow?.WindowTitle ?? string.Empty), "window_title");
        form.Add(new StringContent((request.InputActivity?.KeyboardEventCount ?? 0).ToString()), "keyboard_count");
        form.Add(new StringContent((request.InputActivity?.MouseClickCount ?? 0).ToString()), "mouse_click_count");
        form.Add(new StringContent((request.InputActivity?.MouseMoveCount ?? 0).ToString()), "mouse_move_count");
        form.Add(new StringContent((request.InputActivity?.MouseWheelCount ?? 0).ToString()), "mouse_wheel_count");
        form.Add(new StringContent((request.InputActivity?.WindowSwitchCount ?? 0).ToString()), "window_switch_count");
        form.Add(new StringContent((request.SessionState?.IsLocked ?? false).ToString().ToLowerInvariant()), "is_locked");
        form.Add(new StringContent((request.SessionState?.IsRemoteSession ?? false).ToString().ToLowerInvariant()), "is_remote_session");
        form.Add(new StringContent((request.SessionState?.IsRdpSession ?? false).ToString().ToLowerInvariant()), "is_rdp_session");
        form.Add(new StringContent((request.SessionState?.IdleSeconds ?? 0).ToString()), "idle_seconds");
        form.Add(new StringContent(request.SessionState?.InputDesktopName ?? string.Empty), "input_desktop_name");
        form.Add(new StringContent(request.SessionState?.SessionConnectState ?? string.Empty), "session_connect_state");
        if (!string.IsNullOrWhiteSpace(request.ImageSha256))
        {
            form.Add(new StringContent(request.ImageSha256), "phash");
        }

        var fileContent = new ByteArrayContent(request.ImageBytes);
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(request.ImageFormat);
        form.Add(fileContent, "file", BuildScreenshotFileName(request));

        using var response = await _httpClient.PostAsync(
            "/api/agent/screenshots/upload",
            form,
            cancellationToken);

        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;

        return new ScreenshotUploadResponse
        {
            ScreenshotId = root.TryGetProperty("screenshot_id", out var screenshotId)
                ? screenshotId.GetString() ?? string.Empty
                : string.Empty,
            Status = root.TryGetProperty("upload_status", out var uploadStatus)
                ? uploadStatus.GetString() ?? string.Empty
                : string.Empty,
            ImageUri = root.TryGetProperty("image_uri", out var imageUri)
                ? imageUri.GetString() ?? string.Empty
                : string.Empty,
            ThumbUri = root.TryGetProperty("thumb_uri", out var thumbUri)
                ? thumbUri.GetString() ?? string.Empty
                : string.Empty
        };
    }

    public async Task CompleteScreenshotAsync(
        ScreenshotUploadCompleteRequest request,
        CancellationToken cancellationToken)
    {
        if (_options.DryRun)
        {
            _logger.LogInformation(
                "DryRun screenshot completion to /api/agent/screenshots/{ScreenshotId}/complete.",
                request.ScreenshotId);
            return;
        }

        using var response = await _httpClient.PostAsJsonAsync(
            $"/api/agent/screenshots/{request.ScreenshotId}/complete",
            request,
            cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    private static string BuildScreenshotFileName(ScreenshotUploadRequest request)
    {
        var extension = request.ImageFormat switch
        {
            "image/png" => ".png",
            "image/jpeg" => ".jpg",
            "image/webp" => ".webp",
            "image/bmp" => ".bmp",
            _ => ".bin"
        };

        var display = string.IsNullOrWhiteSpace(request.DisplayName)
            ? "screen"
            : string.Concat(request.DisplayName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '-'));
        return $"{request.CapturedAtUtc:yyyyMMddHHmmss}-{request.ScreenIndex}-{display}{extension}";
    }
}
