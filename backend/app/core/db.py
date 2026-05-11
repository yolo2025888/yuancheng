from __future__ import annotations

from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.exc import NoSuchTableError
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
    ensure_database_schema(engine)


def ensure_database_schema(engine) -> None:
    if engine.dialect.name == "sqlite":
        ensure_sqlite_schema(engine)
        return

    ensure_non_sqlite_schema(engine)


def ensure_sqlite_schema(engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    preparer = engine.dialect.identifier_preparer

    with engine.begin() as connection:
        inspector = inspect(connection)
        for table in SQLModel.metadata.sorted_tables:
            try:
                existing_columns = {column["name"] for column in inspector.get_columns(table.name)}
            except NoSuchTableError:
                continue
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


def ensure_non_sqlite_schema(engine) -> None:
    with engine.begin() as connection:
        inspector = inspect(connection)
        existing_columns_by_table = _existing_columns_by_table(inspector)
        statements = build_non_sqlite_schema_patch_statements(engine.dialect, existing_columns_by_table)
        for statement in statements:
            connection.execute(text(statement))


def build_non_sqlite_schema_patch_statements(dialect, existing_columns_by_table: dict[str, set[str]]) -> list[str]:
    statements: list[str] = []
    preparer = dialect.identifier_preparer
    add_column_if_not_exists = dialect.name == "postgresql"

    for table in SQLModel.metadata.sorted_tables:
        existing_columns = existing_columns_by_table.get(table.name)
        if existing_columns is None:
            continue

        for column in table.columns:
            if column.name in existing_columns or column.primary_key:
                continue
            if not _is_safe_add_column(column):
                continue
            statements.append(
                _build_add_column_sql(
                    table_name=preparer.quote(table.name),
                    column_name=preparer.quote(column.name),
                    column=column,
                    dialect=dialect,
                    add_column_if_not_exists=add_column_if_not_exists,
                )
            )
            existing_columns.add(column.name)

    return statements


def _existing_columns_by_table(inspector) -> dict[str, set[str]]:
    existing_table_names = set(inspector.get_table_names())
    columns_by_table: dict[str, set[str]] = {}

    for table in SQLModel.metadata.sorted_tables:
        if table.name not in existing_table_names:
            continue
        columns_by_table[table.name] = {column["name"] for column in inspector.get_columns(table.name)}

    return columns_by_table


def _is_safe_add_column(column) -> bool:
    return bool(column.nullable or _column_default_value(column) is not None)


def _build_add_column_sql(
    *,
    table_name: str,
    column_name: str,
    column,
    dialect,
    add_column_if_not_exists: bool = False,
) -> str:
    parts = [
        "ALTER TABLE",
        table_name,
        "ADD COLUMN",
    ]
    if add_column_if_not_exists:
        parts.extend(["IF", "NOT", "EXISTS"])
    parts.extend([column_name, column.type.compile(dialect=dialect)])
    default_value = _column_default_value(column)
    if default_value is not None:
        parts.extend(["DEFAULT", _literal_value(default_value, dialect)])
    if not column.nullable:
        parts.append("NOT NULL")
    return " ".join(parts)


def _column_default_value(column) -> Any | None:
    default = getattr(column, "default", None)
    if default is None or default.is_callable or default.is_scalar is False:
        return None
    return default.arg


def _literal_value(value: Any, dialect) -> str:
    if isinstance(value, bool):
        if dialect.name == "postgresql":
            return "TRUE" if value else "FALSE"
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"
