from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import get_current_auth_principal, get_session, get_settings
from app.core.config import Settings
from app.schemas.auth import AuthLoginRequest, AuthLoginResponse, AuthUserResponse
from app.services.auth import AuthService, AuthenticationError, AuthenticatedPrincipal, InactiveUserError

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _build_auth_user_response(principal: AuthenticatedPrincipal) -> AuthUserResponse:
    user = principal.user
    return AuthUserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        role_id=user.role_id,
        role_name=principal.role_name,
        employee_id=user.employee_id,
        status=user.status,
        permissions=sorted(principal.permissions),
    )


@router.post("/login", response_model=AuthLoginResponse)
def login(
    payload: AuthLoginRequest,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AuthLoginResponse:
    try:
        access_token, expires_at, principal = AuthService(session, settings).login(
            username=payload.login_identifier,
            password=payload.password,
        )
    except InactiveUserError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    return AuthLoginResponse(
        access_token=access_token,
        expires_at=expires_at,
        user=_build_auth_user_response(principal),
    )


@router.get("/me", response_model=AuthUserResponse)
def get_me(
    principal: AuthenticatedPrincipal = Depends(get_current_auth_principal),
) -> AuthUserResponse:
    return _build_auth_user_response(principal)
