from __future__ import annotations

from sqlalchemy.dialects import postgresql, sqlite
from sqlmodel import SQLModel

from app.core.db import build_non_sqlite_schema_patch_statements
from app.models import Device, Screenshot  # noqa: F401 - register SQLModel metadata


def _existing_columns_with_missing(table_name: str, missing: set[str]) -> set[str]:
    table = SQLModel.metadata.tables[table_name]
    return {column.name for column in table.columns if column.name not in missing}


def test_postgresql_schema_patch_uses_idempotent_safe_column_adds() -> None:
    missing_screenshot_columns = {
        "activity_type",
        "active_app",
        "activity_confidence",
        "activity_summary",
        "activity_evidence_json",
        "is_locked",
    }
    missing_device_columns = {
        "agent_token_hash",
        "agent_token_revoked_at",
        "agent_token_expires_at",
        "agent_token_last_used_at",
    }
    statements = build_non_sqlite_schema_patch_statements(
        postgresql.dialect(),
        {
            "screenshots": _existing_columns_with_missing("screenshots", missing_screenshot_columns),
            "devices": _existing_columns_with_missing("devices", missing_device_columns),
        },
    )
    ddl = "\n".join(statements)

    for column_name in missing_screenshot_columns | missing_device_columns:
        assert f"ADD COLUMN IF NOT EXISTS {column_name} " in ddl

    assert "ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS activity_summary TEXT" in ddl
    assert "ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS activity_evidence_json JSON" in ddl
    assert "ALTER TABLE devices ADD COLUMN IF NOT EXISTS agent_token_hash VARCHAR" in ddl
    assert "ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE NOT NULL" in ddl


def test_non_sqlite_schema_patch_skips_unsafe_required_columns() -> None:
    statements = build_non_sqlite_schema_patch_statements(
        sqlite.dialect(),
        {
            "screenshots": {"id"},
            "devices": {"id"},
        },
    )
    ddl = "\n".join(statements)

    assert "ALTER TABLE screenshots ADD COLUMN captured_at" not in ddl
    assert "ALTER TABLE screenshots ADD COLUMN employee_id" not in ddl
    assert "ALTER TABLE screenshots ADD COLUMN device_id" not in ddl
