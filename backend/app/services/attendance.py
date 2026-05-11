from __future__ import annotations

from datetime import datetime, time, timezone
from uuid import UUID

from sqlmodel import Session, select

from app.models import AttendanceRecord, Employee
from app.schemas.admin import AttendanceClockRequest, AttendanceReviewRequest
from app.services.audit import AuditContext, AuditService

CLOCK_IN_LATE_AFTER = time(hour=9, minute=30)
CLOCK_OUT_EARLY_BEFORE = time(hour=18, minute=0)


class AttendanceService:
    def __init__(self, session: Session):
        self.session = session
        self.audit = AuditService(session)

    def create_clock_record(self, payload: AttendanceClockRequest) -> AttendanceRecord:
        employee = self._resolve_employee(payload)
        anomaly_status, anomaly_reasons = evaluate_attendance_anomaly(payload.event_type, payload.occurred_at)

        record = AttendanceRecord(
            employee_id=employee.id if employee is not None else None,
            employee_no=payload.employee_no or (employee.employee_no if employee is not None else None),
            user_name=payload.user_name.strip(),
            machine_name=payload.machine_name.strip() if payload.machine_name else None,
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


def evaluate_attendance_anomaly(event_type: str, occurred_at: datetime) -> tuple[str, list[str]]:
    local_time = occurred_at.timetz().replace(tzinfo=None)
    if event_type == "clock_in" and local_time > CLOCK_IN_LATE_AFTER:
        return "late", [f"Clock-in after {CLOCK_IN_LATE_AFTER.strftime('%H:%M')}"]

    if event_type == "clock_out" and local_time < CLOCK_OUT_EARLY_BEFORE:
        return "early_leave", [f"Clock-out before {CLOCK_OUT_EARLY_BEFORE.strftime('%H:%M')}"]

    return "normal", []
