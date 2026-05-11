from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from sqlmodel import Session, select

from app.models import Employee
from app.schemas.admin import EmployeeImportResponse
from app.services.audit import AuditContext, AuditService


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class EmployeeAdminService:
    EXPORT_FIELDNAMES = ["name", "employee_no", "department", "job_role", "manager", "github", "status"]
    FIELD_ALIASES = {
        "name": ("name",),
        "employee_no": ("employee_no", "employee no", "employee number"),
        "department": ("department",),
        "job_role": ("job_role", "job role"),
        "manager": ("manager", "manager_name", "manager name"),
        "github": ("github", "github_username", "github username"),
        "status": ("status",),
    }

    def __init__(self, session: Session):
        self.session = session
        self.audit = AuditService(session)

    def export_employees_csv(self, *, audit_context: AuditContext | None = None) -> str:
        employees = self.session.exec(select(Employee).order_by(Employee.employee_no.asc(), Employee.name.asc())).all()
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=self.EXPORT_FIELDNAMES)
        writer.writeheader()
        for employee in employees:
            writer.writerow(
                {
                    "name": employee.name,
                    "employee_no": employee.employee_no,
                    "department": employee.department or "",
                    "job_role": employee.job_role or "",
                    "manager": employee.manager_name or "",
                    "github": employee.github_username or "",
                    "status": employee.status,
                }
            )

        self.audit.log(
            action="employees.exported",
            target_type="employee_directory",
            target_id=None,
            reason=f"Exported {len(employees)} employees",
            context=audit_context,
        )
        self.session.commit()
        return buffer.getvalue()

    def import_employees_csv(self, csv_text: str, *, audit_context: AuditContext | None = None) -> EmployeeImportResponse:
        if not csv_text.strip():
            raise ValueError("CSV payload is empty")

        reader = csv.DictReader(io.StringIO(csv_text))
        if reader.fieldnames is None:
            raise ValueError("CSV header is required")

        header_map = self._build_header_map(reader.fieldnames)
        missing_columns = [column for column in ("name", "employee_no") if column not in header_map]
        if missing_columns:
            raise ValueError(f"Missing required CSV columns: {', '.join(missing_columns)}")

        existing_employees = {
            employee.employee_no: employee
            for employee in self.session.exec(select(Employee)).all()
        }
        created_count = 0
        updated_count = 0
        skipped_count = 0
        total_rows = 0

        for row in reader:
            total_rows += 1
            normalized_row = {key: self._row_value(row, source_key) for key, source_key in header_map.items()}
            if not any(normalized_row.values()):
                skipped_count += 1
                continue

            name = normalized_row["name"]
            employee_no = normalized_row["employee_no"]
            if not name or not employee_no:
                raise ValueError(f"CSV row {total_rows + 1} must include both name and employee_no")

            employee = existing_employees.get(employee_no)
            if employee is None:
                employee = Employee(
                    name=name,
                    employee_no=employee_no,
                    department=normalized_row.get("department"),
                    job_role=normalized_row.get("job_role"),
                    manager_name=normalized_row.get("manager"),
                    github_username=normalized_row.get("github"),
                    status=normalized_row.get("status") or "active",
                )
                self.session.add(employee)
                self.session.flush()
                existing_employees[employee_no] = employee
                created_count += 1
                continue

            employee.name = name
            employee.department = normalized_row.get("department")
            employee.job_role = normalized_row.get("job_role")
            employee.manager_name = normalized_row.get("manager")
            employee.github_username = normalized_row.get("github")
            employee.status = normalized_row.get("status") or employee.status or "active"
            employee.updated_at = utc_now()
            self.session.add(employee)
            updated_count += 1

        self.audit.log(
            action="employees.imported",
            target_type="employee_directory",
            target_id=None,
            reason=f"Imported {total_rows - skipped_count} rows ({created_count} created, {updated_count} updated)",
            context=audit_context,
        )
        self.session.commit()
        return EmployeeImportResponse(
            total_rows=total_rows,
            created_count=created_count,
            updated_count=updated_count,
            skipped_count=skipped_count,
        )

    def _build_header_map(self, headers: list[str]) -> dict[str, str]:
        normalized_headers = {self._normalize_header(header): header for header in headers}
        header_map: dict[str, str] = {}
        for field_name, aliases in self.FIELD_ALIASES.items():
            for alias in aliases:
                source_key = normalized_headers.get(self._normalize_header(alias))
                if source_key is not None:
                    header_map[field_name] = source_key
                    break
        return header_map

    def _normalize_header(self, value: str) -> str:
        return value.strip().casefold().replace("-", " ").replace("_", " ")

    def _row_value(self, row: dict[str, str | None], key: str) -> str | None:
        value = row.get(key)
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None
