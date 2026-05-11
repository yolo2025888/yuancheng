# Employee Behavior Monitor Backend

Run locally:

```bash
uvicorn app.main:app --reload
```

The backend intentionally fails closed outside tests. Set these `EBM_` environment variables for both development and production; the backend ignores legacy names such as `APP_ENV` and unprefixed `DATABASE_URL`.

```bash
EBM_ENVIRONMENT=development
EBM_AUTH_SECRET=<at-least-32-characters>
EBM_AGENT_API_TOKEN=<agent-signing-secret-at-least-24-characters>
```

`/api/agent/*` requires `Authorization: Bearer v1:<device_id>:<signature>` outside development/test. The signature is HMAC-SHA256 over the normalized device id using `EBM_AGENT_API_TOKEN` as the signing secret; the raw secret itself is rejected outside development/test. Admin screenshot image bytes are served only through authenticated `/api/screenshots/{id}/image` and `/thumbnail` routes; the storage directory is not mounted publicly.

Run tests:

```bash
pytest
```
