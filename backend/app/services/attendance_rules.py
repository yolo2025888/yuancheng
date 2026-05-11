from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timezone

from sqlmodel import Session

from app.models import Policy
from app.schemas.admin import AttendanceRuleUpdateRequest
from app.services.audit import AuditContext, AuditService
from app.services.policies import PolicyService


@dataclass(frozen=True)
class AttendanceRules:
    name: str
    clock_in_late_after: time
    clock_out_early_before: time


DEFAULT_ATTENDANCE_RULES = AttendanceRules(
    name="Default attendance rule",
    clock_in_late_after=time(hour=9, minute=30),
    clock_out_early_before=time(hour=18, minute=0),
)


class AttendanceRuleService:
    RULES_JSON_KEY = "attendance_rule"

    def __init__(self, session: Session | None = None):
        self.session = session
        self.audit = AuditService(session) if session is not None else None

    def get_rules(self, *, employee_no: str | None = None) -> AttendanceRules:
        # Future hook: resolve employee/team-specific or holiday rules here.
        _ = employee_no
        policy = self._get_default_policy()
        if policy is None:
            return DEFAULT_ATTENDANCE_RULES
        return self._rules_from_policy(policy)

    def update_default_rules(
        self,
        payload: AttendanceRuleUpdateRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> AttendanceRules:
        if self.session is None:
            raise RuntimeError("AttendanceRuleService.update_default_rules requires a database session")

        policy = PolicyService(self.session).ensure_default_policy()
        current_rules = self._rules_from_policy(policy)
        updated_rules = AttendanceRules(
            name=payload.name if payload.name is not None else current_rules.name,
            clock_in_late_after=parse_rule_time(payload.clock_in_late_after)
            if payload.clock_in_late_after is not None
            else current_rules.clock_in_late_after,
            clock_out_early_before=parse_rule_time(payload.clock_out_early_before)
            if payload.clock_out_early_before is not None
            else current_rules.clock_out_early_before,
        )

        if updated_rules == current_rules:
            return current_rules

        rules_json = dict(policy.rules_json or {})
        rules_json[self.RULES_JSON_KEY] = self._serialize_rules(updated_rules)
        policy.rules_json = rules_json
        policy.updated_at = datetime.now(timezone.utc)
        self.session.add(policy)
        if self.audit is not None:
            self.audit.log(
                action="attendance_rule.updated",
                target_type="policy",
                target_id=policy.id,
                reason="Updated default attendance rule",
                context=audit_context,
            )
        self.session.commit()
        self.session.refresh(policy)
        return self._rules_from_policy(policy)

    def _get_default_policy(self) -> Policy | None:
        if self.session is None:
            return None
        return PolicyService(self.session).ensure_default_policy()

    def _rules_from_policy(self, policy: Policy) -> AttendanceRules:
        payload = policy.rules_json.get(self.RULES_JSON_KEY) if isinstance(policy.rules_json, dict) else None
        if not isinstance(payload, dict):
            return DEFAULT_ATTENDANCE_RULES

        name = payload.get("name")
        clock_in_late_after = payload.get("clock_in_late_after")
        clock_out_early_before = payload.get("clock_out_early_before")
        try:
            return AttendanceRules(
                name=name.strip() if isinstance(name, str) and name.strip() else DEFAULT_ATTENDANCE_RULES.name,
                clock_in_late_after=parse_rule_time(clock_in_late_after)
                if isinstance(clock_in_late_after, str)
                else DEFAULT_ATTENDANCE_RULES.clock_in_late_after,
                clock_out_early_before=parse_rule_time(clock_out_early_before)
                if isinstance(clock_out_early_before, str)
                else DEFAULT_ATTENDANCE_RULES.clock_out_early_before,
            )
        except ValueError:
            return DEFAULT_ATTENDANCE_RULES

    def _serialize_rules(self, rules: AttendanceRules) -> dict[str, str]:
        return {
            "name": rules.name,
            "clock_in_late_after": format_rule_time(rules.clock_in_late_after),
            "clock_out_early_before": format_rule_time(rules.clock_out_early_before),
        }


def format_rule_time(value: time) -> str:
    return value.strftime("%H:%M")


def parse_rule_time(value: str) -> time:
    try:
        return datetime.strptime(value, "%H:%M").time()
    except ValueError as exc:
        raise ValueError("Time must use HH:MM format") from exc
