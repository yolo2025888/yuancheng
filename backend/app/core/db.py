from __future__ import annotations

from typing import Any

from sqlalchemy import inspect, text
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
    ensure_sqlite_schema(engine)


def ensure_sqlite_schema(engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    preparer = engine.dialect.identifier_preparer

    with engine.begin() as connection:
        for table in SQLModel.metadata.sorted_tables:
            existing_columns = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns or column.primary_key:
                    continue
                if not _is_safe_add_column(column):
                    continue
                ddl = _build_add_column_sql(
                    table_name=preparer.quote(table.name),
                    column_name=preparer.quote(column.name),
                    column=column,
                    dialect=engine.dialect,
                )
                connection.execute(text(ddl))
                existing_columns.add(column.name)


def _is_safe_add_column(column) -> bool:
    return bool(column.nullable or _column_default_value(column) is not None)


def _build_add_column_sql(*, table_name: str, column_name: str, column, dialect) -> str:
    parts = [
        "ALTER TABLE",
        table_name,
        "ADD COLUMN",
        column_name,
        column.type.compile(dialect=dialect),
    ]
    default_value = _column_default_value(column)
    if default_value is not None:
        parts.extend(["DEFAULT", _sqlite_literal(default_value)])
    if not column.nullable:
        parts.append("NOT NULL")
    return " ".join(parts)


def _column_default_value(column) -> Any | None:
    default = getattr(column, "default", None)
    if default is None or default.is_callable or default.is_scalar is False:
        return None
    return default.arg


def _sqlite_literal(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"
