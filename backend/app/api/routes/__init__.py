from app.api.routes.admin import router as admin_router
from app.api.routes.agent import router as agent_router
from app.api.routes.auth import router as auth_router
from app.api.routes.events import router as events_router
from app.api.routes.health import router as health_router
from app.api.routes.screenshots import router as screenshots_router
from app.api.routes.timeline import router as timeline_router

__all__ = ["admin_router", "agent_router", "auth_router", "events_router", "health_router", "screenshots_router", "timeline_router"]
