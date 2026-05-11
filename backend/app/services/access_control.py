from __future__ import annotations

from sqlmodel import Session

from app.models import Role, User

ACCESS_CAPABILITY_DEFINITIONS = (
    {
        "key": "dashboard.view",
        "label": "Dashboard summary",
        "description": "View aggregate employee, device, and risk summary metrics.",
    },
    {
        "key": "risk_scores.view",
        "label": "Risk scores",
        "description": "View employee-level risk scores, labels, and scoring reasons.",
    },
    {
        "key": "events.review",
        "label": "Event review",
        "description": "Review behavior events and update their workflow status.",
    },
    {
        "key": "screenshots.view",
        "label": "Screenshot metadata",
        "description": "View screenshot and window metadata captured from company-owned devices.",
    },
    {
        "key": "policies.manage",
        "label": "Policy management",
        "description": "Create, update, and activate monitoring policy definitions.",
    },
    {
        "key": "audit_logs.view",
        "label": "Audit logs",
        "description": "View policy and review audit log entries.",
    },
    {
        "key": "directory.view",
        "label": "Employee directory",
        "description": "View employee and company device assignment records.",
    },
    {
        "key": "directory.manage",
        "label": "Employee directory import/export",
        "description": "Import and export employee directory records through admin workflows.",
    },
    {
        "key": "device_tokens.manage",
        "label": "Device agent tokens",
        "description": "Issue and revoke device-scoped agent tokens for managed devices.",
    },
    {
        "key": "attendance.view",
        "label": "Attendance records",
        "description": "View employee clock-in, clock-out, and attendance anomaly records.",
    },
    {
        "key": "attendance.manage",
        "label": "Attendance review",
        "description": "Review attendance exceptions and update handling notes.",
    },
    {
        "key": "access_matrix.view",
        "label": "Access planning",
        "description": "View the recommended role and permission planning matrix.",
    },
)

ACCESS_ROLE_TEMPLATES = (
    {
        "name": "Admin",
        "description": "Operations owner with full visibility into monitoring, policy, and audit surfaces.",
        "permission_keys": [definition["key"] for definition in ACCESS_CAPABILITY_DEFINITIONS],
    },
    {
        "name": "Risk Analyst",
        "description": "Investigates elevated risk signals and reviews event workflows.",
        "permission_keys": [
            "dashboard.view",
            "risk_scores.view",
            "events.review",
            "screenshots.view",
            "directory.view",
            "attendance.view",
            "attendance.manage",
        ],
    },
    {
        "name": "Reviewer",
        "description": "Reviews escalated behavior events and supporting screenshot metadata.",
        "permission_keys": [
            "dashboard.view",
            "risk_scores.view",
            "events.review",
            "screenshots.view",
            "directory.view",
            "attendance.view",
            "attendance.manage",
        ],
    },
    {
        "name": "Manager",
        "description": "Sees aggregate team health and employee risk posture without policy editing access.",
        "permission_keys": [
            "dashboard.view",
            "risk_scores.view",
            "directory.view",
            "attendance.view",
        ],
    },
    {
        "name": "Compliance",
        "description": "Audits policy coverage, review activity, and access planning decisions.",
        "permission_keys": [
            "dashboard.view",
            "audit_logs.view",
            "policies.manage",
            "access_matrix.view",
            "directory.view",
            "attendance.view",
            "attendance.manage",
            "device_tokens.manage",
        ],
    },
)


def access_template_for_role(role_name: str | None) -> dict[str, object]:
    normalized_name = (role_name or "").strip().casefold()
    for template in ACCESS_ROLE_TEMPLATES:
        if template["name"].casefold() == normalized_name:
            return template

    return {
        "name": role_name or "Custom",
        "description": "Custom role with no inferred permissions. Assign an explicit supported role before granting access.",
        "permission_keys": [],
    }


def resolve_permissions_for_role_name(role_name: str | None) -> set[str]:
    template = access_template_for_role(role_name)
    return {str(permission) for permission in template["permission_keys"]}


def resolve_permissions_for_user(session: Session, user: User) -> tuple[str | None, set[str]]:
    if user.role_id is None:
        return None, set()

    role = session.get(Role, user.role_id)
    if role is None:
        return None, set()

    return role.name, resolve_permissions_for_role_name(role.name)
