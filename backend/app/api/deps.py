from __future__ import annotations

from collections.abc import Generator
import secrets

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from app.core.config import Settings
from app.services.auth import AuthService, AuthenticatedPrincipal
from app.services.audit import AuditContext

bearer_scheme = HTTPBearer(auto_error=False)


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_session(request: Request) -> Generator[Session, None, None]:
    with Session(request.app.state.engine) as session:
        yield session


def get_optional_auth_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedPrincipal | None:
    if credentials is None:
        return None
    if credentials.scheme.casefold() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication scheme")

    principal = AuthService(session, settings).authenticate_bearer_token(credentials.credentials)
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    request.state.auth_principal = principal
    return principal


def get_current_auth_principal(
    principal: AuthenticatedPrincipal | None = Depends(get_optional_auth_principal),
) -> AuthenticatedPrincipal:
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return principal


def require_permissions(*permission_keys: str):
    def dependency(
        principal: AuthenticatedPrincipal = Depends(get_current_auth_principal),
    ) -> AuthenticatedPrincipal:
        missing_permissions = sorted(set(permission_keys) - principal.permissions)
        if missing_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(missing_permissions)}",
            )
        return principal

    return dependency


def require_agent_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> None:
    configured_token = settings.agent_api_token.strip()
    supplied_token = credentials.credentials if credentials is not None else ""
    if (
        credentials is None
        or credentials.scheme.casefold() != "bearer"
        or not configured_token
        or not secrets.compare_digest(supplied_token, configured_token)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent token")


def get_audit_context(
    request: Request,
    principal: AuthenticatedPrincipal | None = Depends(get_optional_auth_principal),
) -> AuditContext:
    return AuditContext(
        actor_id=principal.user.id if principal is not None else None,
        ip_address=request.client.host if request.client is not None else None,
        user_agent=request.headers.get("user-agent"),
    )
