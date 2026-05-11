from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.models import AuditLog


@dataclass(slots=True)
class AuditContext:
    actor_id: UUID | None = None
    ip_address: str | None = None
    user_agent: str | None = None


class AuditService:
    def __init__(self, session: Session):
        self.session = session

    def log(
        self,
        *,
        action: str,
        target_type: str,
        target_id: UUID | None,
        reason: str | None = None,
        context: AuditContext | None = None,
    ) -> AuditLog:
        audit_log = AuditLog(
            actor_id=context.actor_id if context is not None else None,
            action=action,
            target_type=target_type,
            target_id=target_id,
            reason=reason,
            ip_address=context.ip_address if context is not None else None,
            user_agent=context.user_agent if context is not None else None,
        )
        self.session.add(audit_log)
        return audit_log
