from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.models import Screenshot
from app.services.ai_analysis import AIAnalysisResult, apply_ai_analysis_result
from app.services.screen_analysis import classify_screenshot_activity


def _build_screenshot(
    *,
    foreground_process: str | None = None,
    window_title: str | None = None,
    is_locked: bool = False,
    is_remote_session: bool = False,
    is_rdp_session: bool = False,
    idle_seconds: int | None = None,
    input_desktop_name: str | None = None,
    session_connect_state: str | None = None,
) -> Screenshot:
    return Screenshot(
        id=uuid4(),
        employee_id=uuid4(),
        device_id=uuid4(),
        captured_at=datetime(2026, 5, 11, 10, 0, tzinfo=timezone.utc),
        screen_index=0,
        width=1920,
        height=1080,
        foreground_process=foreground_process,
        window_title=window_title,
        keyboard_count=4,
        mouse_click_count=2,
        mouse_move_count=8,
        is_locked=is_locked,
        is_remote_session=is_remote_session,
        is_rdp_session=is_rdp_session,
        idle_seconds=idle_seconds,
        input_desktop_name=input_desktop_name,
        session_connect_state=session_connect_state,
        upload_status="completed",
        ocr_status="pending",
        analysis_status="pending",
    )


def test_returns_locked_activity_with_sanitized_evidence() -> None:
    screenshot = _build_screenshot(
        foreground_process=r"C:\Windows\System32\LogonUI.exe",
        window_title=r"C:\Users\Alice\Payroll\Q2-Salary.xlsx - Winlogon",
        is_locked=True,
        input_desktop_name="Winlogon",
    )

    activity = classify_screenshot_activity(
        screenshot=screenshot,
        change_level="none",
        is_effective_change=False,
    )

    assert activity.activity_type == "locked"
    assert activity.active_app == "lock_screen"
    assert activity.summary == "Locked session with stable screen."
    assert activity.evidence["matched_keywords"] == []
    assert activity.evidence["matched_signals"] == []
    assert "Alice" not in activity.summary
    assert "Payroll" not in str(activity.evidence)
    assert r"C:\Users\Alice" not in activity.summary


def test_returns_idle_activity_without_raw_window_title_in_summary_or_evidence() -> None:
    screenshot = _build_screenshot(
        foreground_process=r"C:\Program Files\Cursor\Cursor.exe",
        window_title=r"C:\Users\Alice\TopSecret\Roadmap.md - Cursor",
        idle_seconds=900,
    )

    activity = classify_screenshot_activity(
        screenshot=screenshot,
        change_level="minor",
        is_effective_change=False,
    )

    assert activity.activity_type == "idle"
    assert activity.active_app == "cursor"
    assert activity.evidence["matched_keywords"] == ["cursor"]
    assert activity.evidence["matched_signals"] == ["process:cursor", "title:cursor"]
    assert "TopSecret" not in activity.summary
    assert "Roadmap.md" not in str(activity.evidence)
    assert r"C:\Users\Alice" not in str(activity.evidence)


def test_returns_meeting_activity_with_safe_tokens_only() -> None:
    screenshot = _build_screenshot(
        foreground_process="Teams.exe",
        window_title=r"Weekly Sync - Teams - \\corp\hr\salary-sealed.bin",
    )

    activity = classify_screenshot_activity(
        screenshot=screenshot,
        change_level="major",
        is_effective_change=True,
    )

    assert activity.activity_type == "meeting"
    assert activity.active_app == "teams"
    assert activity.evidence["matched_keywords"] == ["teams"]
    assert activity.evidence["matched_signals"] == ["process:teams", "title:teams"]
    assert "Weekly Sync" not in activity.summary
    assert "salary-sealed.bin" not in str(activity.evidence)


def test_returns_documentation_activity_without_sensitive_title_content() -> None:
    screenshot = _build_screenshot(
        foreground_process="WINWORD.EXE",
        window_title=r"Comp Plan 2026 - Word - C:\Users\Alice\HR\Raises.docx",
    )

    activity = classify_screenshot_activity(
        screenshot=screenshot,
        change_level="major",
        is_effective_change=True,
    )

    assert activity.activity_type == "documentation"
    assert activity.active_app == "word"
    assert activity.evidence["matched_keywords"] == ["word"]
    assert activity.evidence["matched_signals"] == ["process:word", "title:word"]
    assert "Comp Plan 2026" not in activity.summary
    assert "Raises.docx" not in str(activity.evidence)


def test_returns_code_review_or_browser_activity_with_repository_tokens_only() -> None:
    screenshot = _build_screenshot(
        foreground_process="chrome.exe",
        window_title=r"Fix auth bug by Alice - Pull Request #42 - github.com/acme/repo - C:\Users\Alice\.ssh",
    )

    activity = classify_screenshot_activity(
        screenshot=screenshot,
        change_level="major",
        is_effective_change=True,
    )

    assert activity.activity_type == "code_review_or_browser"
    assert activity.active_app == "github"
    assert activity.evidence["matched_keywords"] == ["github", "pull_request"]
    assert activity.evidence["matched_signals"] == ["process:chrome", "title:github", "title:pull_request"]
    assert "Fix auth bug by Alice" not in activity.summary
    assert ".ssh" not in str(activity.evidence)


def test_returns_unknown_activity_when_no_safe_signals_exist() -> None:
    screenshot = _build_screenshot(
        foreground_process=r"C:\Program Files\Acme\SensitiveTool.exe",
        window_title=r"Quarterly Bonus Sheet - \\corp\finance\bonus.xlsx",
    )

    activity = classify_screenshot_activity(
        screenshot=screenshot,
        change_level="unknown",
        is_effective_change=True,
    )

    assert activity.activity_type == "unknown"
    assert activity.active_app is None
    assert activity.summary == "Unknown activity during local session with limited visual signal."
    assert activity.evidence["matched_keywords"] == []
    assert activity.evidence["matched_signals"] == []
    assert "Bonus Sheet" not in activity.summary
    assert "bonus.xlsx" not in str(activity.evidence)


def test_apply_ai_analysis_result_updates_optional_ai_fields_when_present() -> None:
    class Target:
        ai_summary: str | None = None
        ai_task_label: str | None = None
        ai_risk_level: str | None = None
        ai_non_work_likelihood: float | None = None
        ai_confidence: float | None = None
        ai_evidence_json: dict[str, object] | None = None
        ai_recommended_follow_up: str | None = None
        ai_provider: str | None = None
        ai_model: str | None = None
        ai_response_id: str | None = None

    target = Target()
    result = AIAnalysisResult(
        summary="Comparing two coding-related screenshots with limited contextual risk.",
        task_label="development_work",
        risk_level="low",
        non_work_likelihood=0.08,
        confidence=0.82,
        evidence=["IDE-like layout", "visible code editor", "small diff between frames"],
        recommended_follow_up="Use as assistive context only; rely on policy rules for enforcement.",
        model="gpt-4.1-mini",
        response_id="resp_123",
    )

    applied_fields = apply_ai_analysis_result(target, result)

    assert applied_fields == [
        "ai_summary",
        "ai_task_label",
        "ai_risk_level",
        "ai_non_work_likelihood",
        "ai_confidence",
        "ai_evidence_json",
        "ai_recommended_follow_up",
        "ai_provider",
        "ai_model",
        "ai_response_id",
    ]
    assert target.ai_summary == result.summary
    assert target.ai_task_label == "development_work"
    assert target.ai_risk_level == "low"
    assert target.ai_non_work_likelihood == 0.08
    assert target.ai_confidence == 0.82
    assert target.ai_evidence_json is not None
    assert target.ai_evidence_json["status"] == "completed"
    assert target.ai_evidence_json["model"] == "gpt-4.1-mini"
    assert target.ai_recommended_follow_up.startswith("Use as assistive context only")
