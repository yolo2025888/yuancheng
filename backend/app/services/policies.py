from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import Settings, get_settings
from app.models import Device, Employee, Policy
from app.schemas.admin import PolicyActivationRequest, PolicyCreateRequest, PolicyUpdateRequest
from app.services.audit import AuditContext, AuditService


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PolicyService:
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
            rules_json=self._normalize_rules_json(payload.rules_json),
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

        if payload.rules_json is not None:
            normalized_rules = self._normalize_rules_json(payload.rules_json)
            if normalized_rules != policy.rules_json:
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
