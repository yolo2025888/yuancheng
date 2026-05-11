from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import hmac
from uuid import UUID

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class AgentPrincipal:
    device_id: UUID | None
    legacy_global_token: bool = False


def create_scoped_agent_token(device_id: UUID | str, settings: Settings) -> str:
    normalized_device_id = str(UUID(str(device_id)))
    signature = hmac.new(
        settings.agent_api_token.encode("utf-8"),
        normalized_device_id.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"v1:{normalized_device_id}:{_urlsafe_b64encode(signature)}"


def authenticate_agent_token(token: str, settings: Settings) -> AgentPrincipal | None:
    normalized_token = token.strip()
    if _legacy_global_token_allowed(settings) and hmac.compare_digest(normalized_token, settings.agent_api_token.strip()):
        return AgentPrincipal(device_id=None, legacy_global_token=True)

    parts = normalized_token.split(":")
    if len(parts) != 3 or parts[0] != "v1":
        return None

    try:
        device_id = UUID(parts[1])
    except ValueError:
        return None

    expected = create_scoped_agent_token(device_id, settings).split(":", maxsplit=2)[2]
    if not hmac.compare_digest(parts[2], expected):
        return None

    return AgentPrincipal(device_id=device_id)


def _legacy_global_token_allowed(settings: Settings) -> bool:
    return settings.environment.strip().casefold() in {"development", "test"}


def _urlsafe_b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")
