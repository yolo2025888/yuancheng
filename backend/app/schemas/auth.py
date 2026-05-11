from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, model_validator


class AuthLoginRequest(BaseModel):
    username: str | None = None
    identifier: str | None = None
    email: str | None = None
    password: str

    @model_validator(mode="after")
    def validate_identifier(self) -> "AuthLoginRequest":
        if not self.login_identifier:
            raise ValueError("username, identifier, or email is required")
        return self

    @property
    def login_identifier(self) -> str:
        return (self.username or self.identifier or self.email or "").strip()


class AuthUserResponse(BaseModel):
    id: UUID
    username: str
    display_name: str | None = None
    email: str | None = None
    role_id: UUID | None = None
    role_name: str | None = None
    status: str
    permissions: list[str]


class AuthLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: AuthUserResponse
