from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session

from app.models import Employee, User
from app.services.access_scope import resolve_employee_access_scope
from app.services.auth import AuthenticatedPrincipal


def _build_principal(*, role_name: str | None, employee_id=None) -> AuthenticatedPrincipal:
    return AuthenticatedPrincipal(
        user=User(
            username=f"user-{uuid4()}",
            password_hash="placeholder",
            employee_id=employee_id,
            status="active",
        ),
        role_name=role_name,
        permissions=set(),
    )


def test_returns_global_scope_for_admin_role(client) -> None:
    with Session(client.app.state.engine) as session:
        scope = resolve_employee_access_scope(session, _build_principal(role_name="Admin"))

    assert scope.all_employees is True
    assert scope.employee_ids == frozenset()


def test_returns_global_scope_for_compliance_role(client) -> None:
    with Session(client.app.state.engine) as session:
        scope = resolve_employee_access_scope(session, _build_principal(role_name="Compliance"))

    assert scope.all_employees is True
    assert scope.employee_ids == frozenset()


def test_returns_bound_employee_and_direct_reports_only(client) -> None:
    manager_id = uuid4()
    direct_report_id = uuid4()
    nested_report_id = uuid4()
    unrelated_employee_id = uuid4()

    with Session(client.app.state.engine) as session:
        session.add(
            Employee(
                id=manager_id,
                name="Manager",
                employee_no="E-100",
                department="Operations",
            )
        )
        session.add(
            Employee(
                id=direct_report_id,
                name="Direct Report",
                employee_no="E-101",
                department="Operations",
                manager_id=manager_id,
            )
        )
        session.add(
            Employee(
                id=nested_report_id,
                name="Nested Report",
                employee_no="E-102",
                department="Operations",
                manager_id=direct_report_id,
            )
        )
        session.add(
            Employee(
                id=unrelated_employee_id,
                name="Unrelated",
                employee_no="E-103",
                department="Operations",
            )
        )
        session.commit()

        scope = resolve_employee_access_scope(
            session,
            _build_principal(role_name="Manager", employee_id=manager_id),
        )

    assert scope.all_employees is False
    assert scope.employee_ids == frozenset({manager_id, direct_report_id})


def test_returns_empty_scope_for_unbound_non_global_role(client) -> None:
    with Session(client.app.state.engine) as session:
        scope = resolve_employee_access_scope(session, _build_principal(role_name="Manager"))

    assert scope.all_employees is False
    assert scope.employee_ids == frozenset()
