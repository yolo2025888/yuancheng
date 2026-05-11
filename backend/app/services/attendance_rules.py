from __future__ import annotations

from dataclasses import dataclass
from datetime import time


@dataclass(frozen=True)
class AttendanceRules:
    clock_in_late_after: time
    clock_out_early_before: time


DEFAULT_ATTENDANCE_RULES = AttendanceRules(
    clock_in_late_after=time(hour=9, minute=30),
    clock_out_early_before=time(hour=18, minute=0),
)


class AttendanceRuleService:
    def get_rules(self, *, employee_no: str | None = None) -> AttendanceRules:
        # Future hook: resolve employee/team-specific or holiday rules here.
        _ = employee_no
        return DEFAULT_ATTENDANCE_RULES


def format_rule_time(value: time) -> str:
    return value.strftime("%H:%M")
