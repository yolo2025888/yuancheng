# Employee Behavior Monitor Backend

Run locally:

```bash
uvicorn app.main:app --reload
```

The backend intentionally fails closed outside tests. Set these `EBM_` environment variables for both development and production; the backend ignores legacy names such as `APP_ENV` and unprefixed `DATABASE_URL`.

```bash
EBM_ENVIRONMENT=development
EBM_AUTH_SECRET=<at-least-32-characters>
EBM_AGENT_API_TOKEN=<server-only-legacy-agent-secret-at-least-24-characters>
```

`/api/agent/*` requires an issued per-device `Authorization: Bearer v2:<device_id>:<secret>` token outside development/test. Issue a token with `POST /api/devices/{device_id}/agent-token`; the plaintext token is returned once, while the backend stores only a hash and can revoke it with `POST /api/devices/{device_id}/agent-token/revoke`. The raw `EBM_AGENT_API_TOKEN` and legacy `v1:` tokens are development/test compatibility paths only. Admin screenshot image bytes are served only through authenticated `/api/screenshots/{id}/image` and `/thumbnail` routes; the storage directory is not mounted publicly.

Run tests:

```bash
pytest
```

Run the local attendance smoke flow:

```bash
python scripts/smoke_attendance_flow.py
```

The smoke flow uses a temporary SQLite database and verifies the path from agent clock-in submission to admin attendance listing, anomaly classification, and review.
