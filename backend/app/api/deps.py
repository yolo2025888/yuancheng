from __future__ import annotations

from collections.abc import Generator

from fastapi import Request
from sqlmodel import Session

from app.core.config import Settings
from app.services.audit import AuditContext


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_session(request: Request) -> Generator[Session, None, None]:
    with Session(request.app.state.engine) as session:
        yield session


def get_audit_context(request: Request) -> AuditContext:
    return AuditContext(
        ip_address=request.client.host if request.client is not None else None,
        user_agent=request.headers.get("user-agent"),
    )
