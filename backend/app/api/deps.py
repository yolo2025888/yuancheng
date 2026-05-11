from __future__ import annotations

from collections.abc import Generator

from fastapi import Request
from sqlmodel import Session

from app.core.config import Settings


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_session(request: Request) -> Generator[Session, None, None]:
    with Session(request.app.state.engine) as session:
        yield session
