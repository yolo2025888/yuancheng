from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import Settings
from app.models import Role, User
from app.services.access_control import access_template_for_role, resolve_permissions_for_user


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _urlsafe_b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str, *, iterations: int, salt: bytes | None = None) -> str:
    effective_salt = salt or secrets.token_bytes(16)
    derived_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), effective_salt, iterations)
    return "pbkdf2_sha256${iterations}${salt}${digest}".format(
        iterations=iterations,
        salt=_urlsafe_b64encode(effective_salt),
        digest=_urlsafe_b64encode(derived_key),
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, digest_text = password_hash.split("$", maxsplit=3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    try:
        iterations = int(iterations_text)
        salt = _urlsafe_b64decode(salt_text)
        expected_digest = _urlsafe_b64decode(digest_text)
    except (TypeError, ValueError):
        return False

    derived_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(derived_key, expected_digest)


@dataclass(slots=True)
class AuthenticatedPrincipal:
    user: User
    role_name: str | None
    permissions: set[str]


class AuthenticationError(ValueError):
    pass


class InactiveUserError(AuthenticationError):
    pass


class AuthService:
    def __init__(
        self,
        session: Session,
        settings: Settings,
        *,
        now_provider: Callable[[], datetime] | None = None,
    ):
        self.session = session
        self.settings = settings
        self._now_provider = now_provider or utc_now

    def login(self, username: str, password: str) -> tuple[str, datetime, AuthenticatedPrincipal]:
        normalized_username = username.strip()
        self._bootstrap_admin_if_allowed(username=normalized_username, password=password)
        user = self.session.exec(select(User).where(User.username == normalized_username)).first()
        if user is None:
            user = self.session.exec(select(User).where(User.email == normalized_username)).first()
        if user is None or not verify_password(password, user.password_hash):
            raise AuthenticationError("Invalid username or password")
        if user.status != "active":
            raise InactiveUserError("User is not active")

        principal = self._build_principal(user)
        expires_at = self._now_provider() + timedelta(seconds=self.settings.session_token_ttl_seconds)
        return self.create_session_token(user, expires_at=expires_at), expires_at, principal

    def authenticate_bearer_token(self, token: str) -> AuthenticatedPrincipal | None:
        claims = self._decode_session_token(token)
        if claims is None:
            return None

        user_id_text = claims.get("sub")
        if not isinstance(user_id_text, str):
            return None

        try:
            user_id = UUID(user_id_text)
        except ValueError:
            return None

        user = self.session.get(User, user_id)
        if user is None or user.status != "active":
            return None

        return self._build_principal(user)

    def create_session_token(self, user: User, *, expires_at: datetime) -> str:
        issued_at = self._now_provider()
        payload = {
            "sub": str(user.id),
            "usr": user.username,
            "iat": int(issued_at.timestamp()),
            "exp": int(expires_at.timestamp()),
        }
        payload_bytes = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        signature = hmac.new(
            self.settings.auth_secret.encode("utf-8"),
            payload_bytes,
            hashlib.sha256,
        ).digest()
        return f"{_urlsafe_b64encode(payload_bytes)}.{_urlsafe_b64encode(signature)}"

    def _decode_session_token(self, token: str) -> dict[str, Any] | None:
        try:
            payload_segment, signature_segment = token.split(".", maxsplit=1)
            payload_bytes = _urlsafe_b64decode(payload_segment)
            signature = _urlsafe_b64decode(signature_segment)
        except (ValueError, TypeError):
            return None

        expected_signature = hmac.new(
            self.settings.auth_secret.encode("utf-8"),
            payload_bytes,
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(signature, expected_signature):
            return None

        try:
            payload = json.loads(payload_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

        expires_at = payload.get("exp")
        if not isinstance(expires_at, int):
            return None
        if expires_at < int(self._now_provider().timestamp()):
            return None
        return payload

    def _bootstrap_admin_if_allowed(self, *, username: str, password: str) -> None:
        if not self.settings.allows_bootstrap_admin:
            return
        normalized_bootstrap_password = self.settings.bootstrap_admin_password.strip().casefold()
        if any(marker in normalized_bootstrap_password for marker in ("replace-with", "change-me", "placeholder")):
            return
        if username not in {self.settings.bootstrap_admin_username, self.settings.bootstrap_admin_email}:
            return
        if password != self.settings.bootstrap_admin_password:
            return

        role = self.session.exec(select(Role).where(Role.name == "Admin")).first()
        if role is None:
            template = access_template_for_role("Admin")
            role = Role(
                name="Admin",
                description=str(template["description"]),
            )
            self.session.add(role)
            self.session.flush()

        password_hash = hash_password(
            self.settings.bootstrap_admin_password,
            iterations=self.settings.password_hash_iterations,
        )

        user = self.session.exec(select(User).where(User.username == self.settings.bootstrap_admin_username)).first()
        if user is None:
            user = self.session.exec(select(User).where(User.email == self.settings.bootstrap_admin_email)).first()

        if user is None:
            user = User(
                username=self.settings.bootstrap_admin_username,
                display_name=self.settings.bootstrap_admin_display_name,
                email=self.settings.bootstrap_admin_email,
                password_hash=password_hash,
                role_id=role.id,
                status="active",
            )
        else:
            user.username = self.settings.bootstrap_admin_username
            user.display_name = self.settings.bootstrap_admin_display_name
            user.email = self.settings.bootstrap_admin_email
            user.password_hash = password_hash
            user.role_id = role.id
            user.status = "active"

        self.session.add(user)
        self.session.commit()

    def _build_principal(self, user: User) -> AuthenticatedPrincipal:
        role_name, permissions = resolve_permissions_for_user(self.session, user)
        return AuthenticatedPrincipal(user=user, role_name=role_name, permissions=permissions)
