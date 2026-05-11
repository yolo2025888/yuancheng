# Backend Schema Self-Heal

The backend creates missing tables with SQLModel metadata at startup. For existing
databases, it also applies a narrow self-heal pass for columns that are safe to
add automatically.

## Scope

- SQLite: adds missing safe columns for local development and test databases.
- PostgreSQL and other non-SQLite dialects: generates `ALTER TABLE ADD COLUMN`
  statements only for existing tables and safe columns.
- PostgreSQL uses `ADD COLUMN IF NOT EXISTS` so repeated startups are idempotent.

## Safety Boundary

The self-heal pass only adds:

- nullable columns
- non-null columns with a scalar default

It skips required columns without defaults because existing rows cannot be
filled safely without a product-specific migration decision.

This is a compatibility aid for MVP deployments, not a replacement for a proper
migration system once the schema stabilizes.
