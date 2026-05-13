from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.models import Device, Employee, Policy
from app.schemas.admin import (
    AIScreenshotAnalysisSettings,
    AIScreenshotAnalysisSettingsUpdateRequest,
    GalleryQuerySettings,
    GalleryQuerySettingsUpdateRequest,
    PolicyActivationRequest,
    PolicyCreateRequest,
    PolicyItem,
    PolicySummary,
    PolicyUpdateRequest,
    ScreenshotRetentionSettings,
    ScreenshotRetentionSettingsUpdateRequest,
)
from app.services.audit import AuditContext, AuditService


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PolicyService:
    AI_ANALYSIS_RULE_KEY = "ai_analysis"
    SCREENSHOT_RETENTION_RULE_KEY = "screenshot_retention"
    GALLERY_QUERY_RULE_KEY = "gallery"
    ROLE_TARGET_KEYS = ("roles", "job_roles", "positions", "target_roles", "target_positions")
    DEPARTMENT_TARGET_KEYS = ("departments", "target_departments")
    ALL_TARGET_KEYS = ROLE_TARGET_KEYS + DEPARTMENT_TARGET_KEYS

    def __init__(self, session: Session, settings: Settings | None = None):
        self.session = session
        self.settings = settings or get_settings()
        self.audit = AuditService(session)

    def ensure_default_policy(self) -> Policy:
        policy = self._get_default_active_policy()
        if policy is not None:
            return policy

        policy = Policy(
            name=self.settings.default_policy_name,
            version=self.settings.default_policy_version,
            screenshot_interval_seconds=self.settings.default_screenshot_interval_seconds,
            no_change_threshold=self.settings.default_no_change_threshold,
            retention_days=self.settings.default_retention_days,
            is_active=True,
            rules_json={},
        )
        self.session.add(policy)
        self.session.commit()
        self.session.refresh(policy)
        return policy

    def resolve_policy_for_device(self, device_id: UUID | None) -> Policy:
        fallback_policy = self.ensure_default_policy()
        if device_id is None:
            return fallback_policy

        device = self.session.get(Device, device_id)
        if device is None or device.employee_id is None:
            return fallback_policy

        employee = self.session.get(Employee, device.employee_id)
        if employee is None:
            return fallback_policy

        matching_policies = [
            policy
            for policy in self._list_active_policies()
            if self._policy_matches_employee(policy, employee)
        ]
        if not matching_policies:
            return fallback_policy

        return max(matching_policies, key=self._policy_priority)

    def create_policy(
        self,
        payload: PolicyCreateRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> Policy:
        policy = Policy(
            name=payload.name,
            version=payload.version,
            screenshot_interval_seconds=payload.screenshot_interval_seconds,
            no_change_threshold=payload.no_change_threshold,
            retention_days=payload.retention_days,
            is_active=payload.is_active,
            created_by=audit_context.actor_id if audit_context is not None else None,
            rules_json=self._rules_json_with_settings(
                payload.rules_json,
                ai_analysis=payload.ai_analysis,
                screenshot_retention=payload.screenshot_retention,
                gallery_query=payload.gallery_query,
            ),
        )
        self.session.add(policy)
        self.audit.log(
            action="policy.created",
            target_type="policy",
            target_id=policy.id,
            reason=f"Created policy {policy.name} v{policy.version}",
            context=audit_context,
        )
        self.session.commit()
        self.session.refresh(policy)
        return policy

    def update_policy(
        self,
        policy_id: UUID,
        payload: PolicyUpdateRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> Policy | None:
        policy = self.session.get(Policy, policy_id)
        if policy is None:
            return None

        changed_fields: list[str] = []
        for field_name in (
            "name",
            "version",
            "screenshot_interval_seconds",
            "no_change_threshold",
            "retention_days",
            "is_active",
        ):
            value = getattr(payload, field_name)
            if value is None or value == getattr(policy, field_name):
                continue
            setattr(policy, field_name, value)
            changed_fields.append(field_name)

        if (
            payload.rules_json is not None
            or payload.ai_analysis is not None
            or payload.screenshot_retention is not None
            or payload.gallery_query is not None
        ):
            base_rules = payload.rules_json if payload.rules_json is not None else policy.rules_json
            normalized_rules = self._rules_json_with_settings(
                base_rules,
                ai_analysis=payload.ai_analysis,
                screenshot_retention=payload.screenshot_retention,
                gallery_query=payload.gallery_query,
            )
            if normalized_rules != self._normalize_rules_json(policy.rules_json):
                policy.rules_json = normalized_rules
                changed_fields.append("rules_json")

        if not changed_fields:
            return policy

        policy.updated_at = utc_now()
        self.session.add(policy)
        self.audit.log(
            action="policy.updated",
            target_type="policy",
            target_id=policy.id,
            reason=f"Updated fields: {', '.join(changed_fields)}",
            context=audit_context,
        )
        self.session.commit()
        self.session.refresh(policy)
        return policy

    def set_policy_activation(
        self,
        policy_id: UUID,
        payload: PolicyActivationRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> Policy | None:
        policy = self.session.get(Policy, policy_id)
        if policy is None:
            return None

        if policy.is_active == payload.is_active:
            return policy

        policy.is_active = payload.is_active
        policy.updated_at = utc_now()
        self.session.add(policy)
        self.audit.log(
            action="policy.activated" if payload.is_active else "policy.deactivated",
            target_type="policy",
            target_id=policy.id,
            reason=f"{'Activated' if payload.is_active else 'Deactivated'} policy {policy.name} v{policy.version}",
            context=audit_context,
        )
        self.session.commit()
        self.session.refresh(policy)
        return policy

    def delete_policy(
        self,
        policy_id: UUID,
        *,
        audit_context: AuditContext | None = None,
    ) -> bool:
        policy = self.session.get(Policy, policy_id)
        if policy is None:
            return False

        self.audit.log(
            action="policy.deleted",
            target_type="policy",
            target_id=policy.id,
            reason=f"Deleted policy {policy.name} v{policy.version}",
            context=audit_context,
        )
        self.session.delete(policy)
        self.session.commit()
        return True

    def get_ai_analysis_settings(self) -> AIScreenshotAnalysisSettings:
        policy = self.ensure_default_policy()
        return self._serialize_ai_analysis_settings(policy.rules_json)

    def get_screenshot_retention_settings(
        self,
        policy: Policy | None = None,
    ) -> ScreenshotRetentionSettings:
        target_policy = policy or self.ensure_default_policy()
        return self._serialize_screenshot_retention_settings(target_policy.rules_json)

    def get_gallery_query_settings(
        self,
        policy: Policy | None = None,
    ) -> GalleryQuerySettings:
        target_policy = policy or self.ensure_default_policy()
        return self._serialize_gallery_query_settings(target_policy.rules_json)

    def update_ai_analysis_settings(
        self,
        payload: AIScreenshotAnalysisSettingsUpdateRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> AIScreenshotAnalysisSettings:
        policy = self.ensure_default_policy()
        policy.rules_json = self._rules_json_with_settings(policy.rules_json, ai_analysis=payload)
        policy.updated_at = utc_now()
        self.session.add(policy)
        self.audit.log(
            action="ai_analysis.settings.updated",
            target_type="policy",
            target_id=policy.id,
            reason=f"Updated AI screenshot analysis settings on {policy.name} v{policy.version}",
            context=audit_context,
        )
        self.session.commit()
        self.session.refresh(policy)
        return self._serialize_ai_analysis_settings(policy.rules_json)

    def serialize_policy(self, policy: Policy) -> PolicyItem:
        return PolicyItem(
            id=policy.id,
            name=policy.name,
            version=policy.version,
            screenshot_interval_seconds=policy.screenshot_interval_seconds,
            no_change_threshold=policy.no_change_threshold,
            retention_days=policy.retention_days,
            is_active=policy.is_active,
            rules_json=self._sanitize_rules_json(policy.rules_json),
            ai_analysis=self._serialize_ai_analysis_settings(policy.rules_json),
            screenshot_retention=self._serialize_screenshot_retention_settings(policy.rules_json),
            gallery_query=self._serialize_gallery_query_settings(policy.rules_json),
            created_at=policy.created_at,
            updated_at=policy.updated_at,
        )

    def serialize_policy_summary(self, policy: Policy) -> PolicySummary:
        return PolicySummary(
            id=policy.id,
            name=policy.name,
            version=policy.version,
            screenshot_interval_seconds=policy.screenshot_interval_seconds,
            no_change_threshold=policy.no_change_threshold,
            retention_days=policy.retention_days,
            is_active=policy.is_active,
            rules_json=self._sanitize_rules_json(policy.rules_json),
            ai_analysis=self._serialize_ai_analysis_settings(policy.rules_json),
            screenshot_retention=self._serialize_screenshot_retention_settings(policy.rules_json),
            gallery_query=self._serialize_gallery_query_settings(policy.rules_json),
        )

    def _get_default_active_policy(self) -> Policy | None:
        default_candidates = [
            policy for policy in self._list_active_policies() if not self._has_target_rules(policy.rules_json)
        ]
        if not default_candidates:
            return None
        return max(
            default_candidates,
            key=lambda policy: (
                policy.name == self.settings.default_policy_name,
                policy.updated_at,
                policy.created_at,
            ),
        )

    def _list_active_policies(self) -> list[Policy]:
        return self.session.exec(
            select(Policy).where(Policy.is_active.is_(True)).order_by(Policy.created_at.desc())
        ).all()

    def _policy_matches_employee(self, policy: Policy, employee: Employee) -> bool:
        normalized_rules = self._normalize_rules_json(policy.rules_json)
        if not self._has_target_rules(normalized_rules):
            return False

        role_targets = self._normalized_values_for_keys(normalized_rules, self.ROLE_TARGET_KEYS)
        department_targets = self._normalized_values_for_keys(normalized_rules, self.DEPARTMENT_TARGET_KEYS)
        employee_role = self._normalize_value(employee.job_role)
        employee_department = self._normalize_value(employee.department)

        if role_targets and employee_role not in role_targets:
            return False
        if department_targets and employee_department not in department_targets:
            return False
        return True

    def _policy_priority(self, policy: Policy) -> tuple[int, int, datetime, datetime]:
        normalized_rules = self._normalize_rules_json(policy.rules_json)
        role_targets = self._normalized_values_for_keys(normalized_rules, self.ROLE_TARGET_KEYS)
        department_targets = self._normalized_values_for_keys(normalized_rules, self.DEPARTMENT_TARGET_KEYS)
        return (
            int(bool(role_targets)) + int(bool(department_targets)),
            len(role_targets) + len(department_targets),
            policy.updated_at,
            policy.created_at,
        )

    def policy_scope_type(self, policy: Policy) -> str:
        return "targeted" if self._has_target_rules(self._normalize_rules_json(policy.rules_json)) else "default"

    def _normalize_rules_json(self, rules_json: dict[str, Any] | None) -> dict[str, Any]:
        if rules_json is None:
            return {}
        if not isinstance(rules_json, dict):
            raise ValueError("rules_json must be an object")

        normalized: dict[str, Any] = {}
        for key, value in rules_json.items():
            if key == self.AI_ANALYSIS_RULE_KEY:
                normalized[key] = self._normalize_ai_analysis_settings(value)
                continue
            if key == self.SCREENSHOT_RETENTION_RULE_KEY:
                normalized[key] = self._normalize_screenshot_retention_settings(value)
                continue
            if key == self.GALLERY_QUERY_RULE_KEY:
                normalized[key] = self._normalize_gallery_query_settings(value)
                continue
            if key not in self.ALL_TARGET_KEYS:
                normalized[key] = value
                continue
            if value is None:
                continue
            if not isinstance(value, list):
                raise ValueError(f"{key} must be an array")
            normalized[key] = [item for item in (self._normalize_value(item) for item in value) if item]
        return normalized

    def _has_target_rules(self, rules_json: dict[str, Any]) -> bool:
        return any(self._normalized_values_for_keys(rules_json, self.ALL_TARGET_KEYS))

    def _normalized_values_for_keys(self, rules_json: dict[str, Any], keys: Iterable[str]) -> set[str]:
        values: set[str] = set()
        for key in keys:
            raw_values = rules_json.get(key)
            if not isinstance(raw_values, list):
                continue
            values.update(item for item in (self._normalize_value(value) for value in raw_values) if item)
        return values

    def _normalize_value(self, value: Any) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().casefold()
        return normalized or None

    def _rules_json_with_settings(
        self,
        rules_json: dict[str, Any] | None,
        *,
        ai_analysis: AIScreenshotAnalysisSettingsUpdateRequest | None = None,
        screenshot_retention: ScreenshotRetentionSettingsUpdateRequest | None = None,
        gallery_query: GalleryQuerySettingsUpdateRequest | None = None,
    ) -> dict[str, Any]:
        normalized_rules = self._normalize_rules_json(rules_json)
        if ai_analysis is None and screenshot_retention is None and gallery_query is None:
            return normalized_rules

        merged_rules = dict(normalized_rules)
        if ai_analysis is not None:
            merged_rules[self.AI_ANALYSIS_RULE_KEY] = self._merge_ai_analysis_settings(
                merged_rules.get(self.AI_ANALYSIS_RULE_KEY),
                ai_analysis,
            )
        if screenshot_retention is not None:
            merged_rules[self.SCREENSHOT_RETENTION_RULE_KEY] = self._merge_screenshot_retention_settings(
                merged_rules.get(self.SCREENSHOT_RETENTION_RULE_KEY),
                screenshot_retention,
            )
        if gallery_query is not None:
            merged_rules[self.GALLERY_QUERY_RULE_KEY] = self._merge_gallery_query_settings(
                merged_rules.get(self.GALLERY_QUERY_RULE_KEY),
                gallery_query,
            )
        return self._normalize_rules_json(merged_rules)

    def _merge_ai_analysis_settings(
        self,
        existing_settings: Any,
        payload: AIScreenshotAnalysisSettingsUpdateRequest,
    ) -> dict[str, Any]:
        merged = self._normalize_ai_analysis_settings(existing_settings)
        provided_fields = payload.model_fields_set

        for field_name in (
            "enabled",
            "provider",
            "model",
            "base_url",
            "timeout_seconds",
            "use_previous_screenshot",
            "confidence_threshold",
            "risk_threshold",
        ):
            if field_name not in provided_fields:
                continue
            value = getattr(payload, field_name)
            if value is None:
                merged.pop(field_name, None)
                continue
            merged[field_name] = value

        if payload.clear_api_key:
            merged.pop("api_key", None)
        elif "api_key" in provided_fields:
            if payload.api_key is None:
                merged.pop("api_key", None)
            else:
                merged["api_key"] = payload.api_key

        return merged

    def _normalize_ai_analysis_settings(self, raw_settings: Any) -> dict[str, Any]:
        if raw_settings is None:
            return {}
        if not isinstance(raw_settings, dict):
            raise ValueError("ai_analysis must be an object")

        normalized: dict[str, Any] = {}

        enabled = raw_settings.get("enabled")
        if isinstance(enabled, bool):
            normalized["enabled"] = enabled

        timeout_seconds = raw_settings.get("timeout_seconds")
        if isinstance(timeout_seconds, int) and timeout_seconds >= 1:
            normalized["timeout_seconds"] = timeout_seconds

        use_previous_screenshot = raw_settings.get("use_previous_screenshot")
        if isinstance(use_previous_screenshot, bool):
            normalized["use_previous_screenshot"] = use_previous_screenshot

        for field_name in ("confidence_threshold", "risk_threshold"):
            value = raw_settings.get(field_name)
            if isinstance(value, (int, float)):
                normalized[field_name] = float(value)

        for field_name in ("provider", "model", "base_url", "api_key"):
            value = raw_settings.get(field_name)
            if value is None:
                continue
            cleaned = str(value).strip()
            if cleaned:
                normalized[field_name] = cleaned

        return normalized

    def _merge_screenshot_retention_settings(
        self,
        existing_settings: Any,
        payload: ScreenshotRetentionSettingsUpdateRequest,
    ) -> dict[str, Any]:
        merged = self._normalize_screenshot_retention_settings(existing_settings)
        for field_name in payload.model_fields_set:
            value = getattr(payload, field_name)
            if value is None:
                merged.pop(field_name, None)
                continue
            merged[field_name] = value
        return merged

    def _normalize_screenshot_retention_settings(self, raw_settings: Any) -> dict[str, Any]:
        if raw_settings is None:
            return {}
        if not isinstance(raw_settings, dict):
            raise ValueError("screenshot_retention must be an object")

        normalized: dict[str, Any] = {}
        enabled = raw_settings.get("enabled")
        if isinstance(enabled, bool):
            normalized["enabled"] = enabled

        normal_mode = raw_settings.get("normal_mode")
        if isinstance(normal_mode, str):
            cleaned_mode = normal_mode.strip()
            if cleaned_mode in {"delete_on_next_cycle", "keep_until_cleanup"}:
                normalized["normal_mode"] = cleaned_mode

        for field_name in (
            "keep_latest_normal_cycles",
            "needs_review_retention_days",
            "high_risk_retention_days",
            "ai_failure_retention_days",
            "skipped_analysis_retention_days",
        ):
            value = raw_settings.get(field_name)
            if isinstance(value, int) and value >= 1:
                normalized[field_name] = value

        return normalized

    def _merge_gallery_query_settings(
        self,
        existing_settings: Any,
        payload: GalleryQuerySettingsUpdateRequest,
    ) -> dict[str, Any]:
        merged = self._normalize_gallery_query_settings(existing_settings)
        for field_name in payload.model_fields_set:
            value = getattr(payload, field_name)
            if value is None:
                merged.pop(field_name, None)
                continue
            merged[field_name] = value
        return merged

    def _normalize_gallery_query_settings(self, raw_settings: Any) -> dict[str, Any]:
        if raw_settings is None:
            return {}
        if not isinstance(raw_settings, dict):
            raise ValueError("gallery must be an object")

        normalized: dict[str, Any] = {}
        default_page_size = raw_settings.get("default_page_size")
        max_page_size = raw_settings.get("max_page_size")
        if isinstance(default_page_size, int) and default_page_size >= 1:
            normalized["default_page_size"] = min(default_page_size, 200)
        if isinstance(max_page_size, int) and max_page_size >= 1:
            normalized["max_page_size"] = min(max_page_size, 500)
        if (
            "default_page_size" in normalized
            and "max_page_size" in normalized
            and normalized["default_page_size"] > normalized["max_page_size"]
        ):
            normalized["default_page_size"] = normalized["max_page_size"]

        for field_name in ("default_descending", "default_only_abnormal"):
            value = raw_settings.get(field_name)
            if isinstance(value, bool):
                normalized[field_name] = value

        return normalized

    def _serialize_ai_analysis_settings(self, rules_json: dict[str, Any] | None) -> AIScreenshotAnalysisSettings:
        settings = self._normalize_ai_analysis_settings(self._normalize_rules_json(rules_json).get(self.AI_ANALYSIS_RULE_KEY))
        api_key = settings.get("api_key")
        return AIScreenshotAnalysisSettings(
            enabled=bool(settings.get("enabled", False)),
            provider=settings.get("provider"),
            model=settings.get("model"),
            base_url=settings.get("base_url"),
            timeout_seconds=int(settings.get("timeout_seconds", 20)),
            use_previous_screenshot=bool(settings.get("use_previous_screenshot", True)),
            confidence_threshold=float(settings.get("confidence_threshold", 0.7)),
            risk_threshold=float(settings.get("risk_threshold", 0.7)),
            has_api_key=bool(api_key),
            api_key_masked=self._mask_secret(api_key) if isinstance(api_key, str) else None,
        )

    def _serialize_screenshot_retention_settings(
        self,
        rules_json: dict[str, Any] | None,
    ) -> ScreenshotRetentionSettings:
        settings = self._normalize_screenshot_retention_settings(
            self._normalize_rules_json(rules_json).get(self.SCREENSHOT_RETENTION_RULE_KEY)
        )
        return ScreenshotRetentionSettings(
            enabled=bool(settings.get("enabled", True)),
            normal_mode=str(settings.get("normal_mode", "delete_on_next_cycle")),
            keep_latest_normal_cycles=int(settings.get("keep_latest_normal_cycles", 1)),
            needs_review_retention_days=int(settings.get("needs_review_retention_days", 7)),
            high_risk_retention_days=int(settings.get("high_risk_retention_days", 30)),
            ai_failure_retention_days=int(settings.get("ai_failure_retention_days", 7)),
            skipped_analysis_retention_days=int(settings.get("skipped_analysis_retention_days", 3)),
        )

    def _serialize_gallery_query_settings(
        self,
        rules_json: dict[str, Any] | None,
    ) -> GalleryQuerySettings:
        settings = self._normalize_gallery_query_settings(
            self._normalize_rules_json(rules_json).get(self.GALLERY_QUERY_RULE_KEY)
        )
        default_page_size = int(settings.get("default_page_size", 20))
        max_page_size = int(settings.get("max_page_size", 200))
        default_page_size = min(default_page_size, max_page_size)
        return GalleryQuerySettings(
            default_page_size=default_page_size,
            max_page_size=max_page_size,
            default_descending=bool(settings.get("default_descending", True)),
            default_only_abnormal=bool(settings.get("default_only_abnormal", False)),
        )

    def _sanitize_rules_json(self, rules_json: dict[str, Any] | None) -> dict[str, Any]:
        normalized_rules = self._normalize_rules_json(rules_json)
        sanitized = dict(normalized_rules)
        ai_analysis = sanitized.get(self.AI_ANALYSIS_RULE_KEY)
        if isinstance(ai_analysis, dict):
            sanitized_ai_analysis = dict(ai_analysis)
            api_key = sanitized_ai_analysis.pop("api_key", None)
            sanitized_ai_analysis["has_api_key"] = bool(api_key)
            sanitized_ai_analysis["api_key_masked"] = (
                self._mask_secret(api_key) if isinstance(api_key, str) and api_key else None
            )
            sanitized[self.AI_ANALYSIS_RULE_KEY] = sanitized_ai_analysis
        return sanitized

    def _mask_secret(self, secret: str) -> str:
        stripped = secret.strip()
        if len(stripped) <= 8:
            return "*" * len(stripped)
        return f"{stripped[:4]}...{stripped[-4:]}"
