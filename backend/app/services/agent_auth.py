from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import hmac
import secrets
from uuid import UUID

from sqlmodel import Session

from app.core.config import Settings
from app.models import Device


@dataclass(frozen=True, slots=True)
class AgentPrincipal:
    device_id: UUID | None
    legacy_global_token: bool = False
    token_version: str = "legacy"


def create_scoped_agent_token(device_id: UUID | str, settings: Settings) -> str:
    """Create the legacy v1 HMAC token.

    v1 depends on a fleet-wide signing secret and is retained only for
    development/test compatibility while deployments move to v2 device secrets.
    """
    normalized_device_id = str(UUID(str(device_id)))
    signature = hmac.new(
        settings.agent_api_token.encode("utf-8"),
        normalized_device_id.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"v1:{normalized_device_id}:{_urlsafe_b64encode(signature)}"


def generate_device_agent_secret() -> str:
    return secrets.token_urlsafe(32)


def create_device_agent_token(device_id: UUID | str, secret: str) -> str:
    normalized_device_id = str(UUID(str(device_id)))
    return f"v2:{normalized_device_id}:{secret.strip()}"


def hash_device_agent_secret(secret: str) -> str:
    digest = hashlib.sha256(secret.strip().encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def authenticate_agent_token(token: str, settings: Settings, session: Session) -> AgentPrincipal | None:
    normalized_token = token.strip()
    if _legacy_global_token_allowed(settings) and hmac.compare_digest(normalized_token, settings.agent_api_token.strip()):
        return AgentPrincipal(device_id=None, legacy_global_token=True, token_version="global")

    parts = normalized_token.split(":")
    if len(parts) != 3:
        return None

    version, raw_device_id, credential = parts
    try:
        device_id = UUID(raw_device_id)
    except ValueError:
        return None

    if version == "v2":
        device = session.get(Device, device_id)
        if (
            device is None
            or device.agent_token_hash is None
            or device.agent_token_revoked_at is not None
        ):
            return None

        supplied_hash = hash_device_agent_secret(credential)
        if not hmac.compare_digest(supplied_hash, device.agent_token_hash):
            return None

        return AgentPrincipal(device_id=device_id, token_version="v2")

    if version != "v1" or not _legacy_global_token_allowed(settings):
        return None

    expected = create_scoped_agent_token(device_id, settings).split(":", maxsplit=2)[2]
    if not hmac.compare_digest(credential, expected):
        return None

    return AgentPrincipal(device_id=device_id, token_version="v1")


def _legacy_global_token_allowed(settings: Settings) -> bool:
    return settings.environment.strip().casefold() in {"development", "test"}


def _urlsafe_b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")
