from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlmodel import Session, select

from app.models import AttendanceRecord, Device, Employee
from app.schemas.admin import AttendanceClockRequest, AttendanceReviewRequest
from app.services.attendance_rules import AttendanceRules, AttendanceRuleService, format_rule_time
from app.services.audit import AuditContext, AuditService


class AttendanceService:
    def __init__(self, session: Session):
        self.session = session
        self.audit = AuditService(session)

    def create_clock_record(self, payload: AttendanceClockRequest) -> AttendanceRecord:
        employee = self._resolve_employee(payload)
        device = self._resolve_device(payload)
        if employee is None and device is not None and device.employee_id is not None:
            employee = self.session.get(Employee, device.employee_id)
        rules = AttendanceRuleService(self.session).get_rules(employee_no=payload.employee_no)
        anomaly_status, anomaly_reasons = evaluate_attendance_anomaly(payload.event_type, payload.occurred_at, rules)
        if self._has_existing_clock_record(employee, payload):
            anomaly_status = f"duplicate_{payload.event_type}"
            anomaly_reasons.append(
                f"Duplicate {payload.event_type.replace('_', '-')} for {payload.occurred_at.date().isoformat()}"
            )

        record = AttendanceRecord(
            employee_id=employee.id if employee is not None else None,
            device_id=device.id if device is not None else None,
            employee_no=payload.employee_no or (employee.employee_no if employee is not None else None),
            user_name=payload.user_name.strip(),
            machine_name=payload.machine_name,
            event_type=payload.event_type,
            occurred_at=payload.occurred_at,
            work_date=payload.occurred_at.date(),
            anomaly_status=anomaly_status,
            anomaly_reasons_json=anomaly_reasons,
            review_status="pending" if anomaly_status != "normal" else "reviewed",
            source=payload.source,
        )
        self.session.add(record)
        self.session.commit()
        self.session.refresh(record)
        return record

    def _has_existing_clock_record(self, employee: Employee | None, payload: AttendanceClockRequest) -> bool:
        statement = (
            select(AttendanceRecord)
            .where(AttendanceRecord.work_date == payload.occurred_at.date())
            .where(AttendanceRecord.event_type == payload.event_type)
        )
        if employee is not None:
            statement = statement.where(AttendanceRecord.employee_id == employee.id)
        elif payload.employee_no:
            statement = statement.where(AttendanceRecord.employee_no == payload.employee_no)
        else:
            statement = statement.where(AttendanceRecord.user_name == payload.user_name.strip())
        return self.session.exec(statement).first() is not None

    def review_record(
        self,
        record_id: UUID,
        payload: AttendanceReviewRequest,
        *,
        audit_context: AuditContext | None = None,
    ) -> AttendanceRecord | None:
        record = self.session.get(AttendanceRecord, record_id)
        if record is None:
            return None

        record.review_status = payload.review_status
        record.review_note = payload.review_note
        record.reviewed_by = audit_context.actor_id if audit_context is not None else None
        record.reviewed_at = datetime.now(timezone.utc)
        record.updated_at = record.reviewed_at
        self.session.add(record)
        self.audit.log(
            action="attendance.reviewed",
            target_type="attendance_record",
            target_id=record.id,
            reason=payload.review_note or f"Set attendance review status to {payload.review_status}",
            context=audit_context,
        )
        self.session.commit()
        self.session.refresh(record)
        return record

    def _resolve_employee(self, payload: AttendanceClockRequest) -> Employee | None:
        employee_no = (payload.employee_no or "").strip()
        if employee_no:
            employee = self.session.exec(select(Employee).where(Employee.employee_no == employee_no)).first()
            if employee is not None:
                return employee

        user_name = payload.user_name.strip()
        if not user_name:
            return None
        return self.session.exec(select(Employee).where(Employee.name == user_name)).first()

    def _resolve_device(self, payload: AttendanceClockRequest) -> Device | None:
        if payload.device_id is not None:
            return self.session.get(Device, payload.device_id)

        machine_name = payload.machine_name
        if not machine_name:
            return None
        return self.session.exec(select(Device).where(Device.hostname == machine_name)).first()


def evaluate_attendance_anomaly(
    event_type: str,
    occurred_at: datetime,
    rules: AttendanceRules | None = None,
) -> tuple[str, list[str]]:
    effective_rules = rules or AttendanceRuleService().get_rules()
    local_time = occurred_at.timetz().replace(tzinfo=None)
    if event_type == "clock_in" and local_time > effective_rules.clock_in_late_after:
        return "late", [f"Clock-in after {format_rule_time(effective_rules.clock_in_late_after)}"]

    if event_type == "clock_out" and local_time < effective_rules.clock_out_early_before:
        return "early_leave", [f"Clock-out before {format_rule_time(effective_rules.clock_out_early_before)}"]

    return "normal", []
