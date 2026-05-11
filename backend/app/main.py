from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlmodel import Session

from app.api.routes import agent_router, events_router, health_router, timeline_router
from app.core.config import Settings, get_settings
from app.core.db import build_engine, create_database_and_tables
from app.services.agent import AgentService


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        create_database_and_tables(app.state.engine)
        with Session(app.state.engine) as session:
            AgentService(session, app_settings).ensure_default_policy()
        yield

    app = FastAPI(title=app_settings.app_name, lifespan=lifespan)
    app.state.settings = app_settings
    app.state.engine = build_engine(app_settings.database_url)
    app.include_router(health_router)
    app.include_router(agent_router)
    app.include_router(timeline_router)
    app.include_router(events_router)
    return app


app = create_app()
