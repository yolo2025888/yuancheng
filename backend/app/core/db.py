from __future__ import annotations

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine


def build_engine(database_url: str):
    connect_args: dict[str, object] = {}
    engine_kwargs: dict[str, object] = {}

    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        if ":memory:" in database_url:
            engine_kwargs["poolclass"] = StaticPool

    return create_engine(database_url, connect_args=connect_args, **engine_kwargs)


def create_database_and_tables(engine) -> None:
    SQLModel.metadata.create_all(engine)
