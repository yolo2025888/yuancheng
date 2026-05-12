from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

from sqlmodel import Session, select

from app.models import Device, Employee

if TYPE_CHECKING:
    from app.services.auth import AuthenticatedPrincipal


GLOBAL_DATA_ROLES = {"admin", "compliance"}


@dataclass(frozen=True)
class EmployeeAccessScope:
    all_employees: bool
    employee_ids: frozenset[UUID] = frozenset()

    def allows_employee(self, employee_id: UUID) -> bool:
        return self.all_employees or employee_id in self.employee_ids


def resolve_employee_access_scope(session: Session, principal: AuthenticatedPrincipal) -> EmployeeAccessScope:
    role_name = (principal.role_name or "").strip().casefold()
    if role_name in GLOBAL_DATA_ROLES:
        return EmployeeAccessScope(all_employees=True)

    if principal.user.employee_id is not None:
        return _resolve_bound_employee_scope(session, principal.user.employee_id)

    return EmployeeAccessScope(all_employees=False)


def _resolve_bound_employee_scope(session: Session, employee_id: UUID) -> EmployeeAccessScope:
    employee_ids = set(
        session.exec(
            select(Employee.id).where((Employee.id == employee_id) | (Employee.manager_id == employee_id))
        ).all()
    )
    return EmployeeAccessScope(
        all_employees=False,
        employee_ids=frozenset(employee_ids),
    )


def require_employee_in_scope(scope: EmployeeAccessScope, employee_id: UUID) -> None:
    if not scope.all_employees and employee_id not in scope.employee_ids:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employee is outside the current access scope")


def require_device_in_scope(session: Session, scope: EmployeeAccessScope, device_id: UUID) -> None:
    if scope.all_employees:
        return

    device = session.get(Device, device_id)
    if device is None or device.employee_id not in scope.employee_ids:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Device is outside the current access scope")
