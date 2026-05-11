# Employee Behavior Monitor Backend

Run locally:

```bash
uvicorn app.main:app --reload
```

Development defaults are intentionally convenient, but production must set these `EBM_` environment variables. The backend ignores legacy names such as `APP_ENV` and unprefixed `DATABASE_URL`.

```bash
EBM_ENVIRONMENT=production
EBM_AUTH_SECRET=<at-least-32-characters>
EBM_AGENT_API_TOKEN=<agent-bearer-token-at-least-24-characters>
```

`/api/agent/*` requires `Authorization: Bearer <EBM_AGENT_API_TOKEN>`. Admin screenshot image bytes are served only through authenticated `/api/screenshots/{id}/image` and `/thumbnail` routes; the storage directory is not mounted publicly.

Run tests:

```bash
pytest
```
