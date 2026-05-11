from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from app.api.routes import admin_router, agent_router, events_router, health_router, screenshots_router, timeline_router
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    storage_root = Path(app_settings.storage_root_dir)
    if not storage_root.is_absolute():
        storage_root = Path(__file__).resolve().parents[1] / storage_root
    storage_root.mkdir(parents=True, exist_ok=True)
    app.mount("/storage", StaticFiles(directory=storage_root), name="storage")

    app.include_router(health_router)
    app.include_router(admin_router)
    app.include_router(agent_router)
    app.include_router(screenshots_router)
    app.include_router(timeline_router)
    app.include_router(events_router)
    return app


app = create_app()
