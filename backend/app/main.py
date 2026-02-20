import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.routers.accounts import router as accounts_router
from app.routers.assets import router as assets_router
from app.routers.auth import router as auth_router
from app.routers.discovery import router as discovery_router
from app.routers.graph import router as graph_router
from app.routers.scheduler import router as scheduler_router
from app.routers.topics import router as topics_router
from app.routers.topics import subtopics_router
from app.routers.tweets import router as tweets_router


@asynccontextmanager
async def lifespan(app):
    from app.scheduler import start_scheduler, stop_scheduler
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="tpot-digest", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Basic auth middleware — only active when AUTH_USER and AUTH_PASS are set
_auth_user = os.environ.get("AUTH_USER")
_auth_pass = os.environ.get("AUTH_PASS")


@app.middleware("http")
async def basic_auth_middleware(request: Request, call_next):
    if not _auth_user or not _auth_pass:
        return await call_next(request)

    # Skip auth for health check
    if request.url.path == "/api/health":
        return await call_next(request)

    import base64
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Basic "):
        try:
            decoded = base64.b64decode(auth_header[6:]).decode()
            user, passwd = decoded.split(":", 1)
            if secrets.compare_digest(user, _auth_user) and secrets.compare_digest(passwd, _auth_pass):
                return await call_next(request)
        except Exception:
            pass

    return Response(
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="tpot-digest"'},
        content="Unauthorized",
    )


app.include_router(accounts_router)
app.include_router(assets_router)
app.include_router(auth_router)
app.include_router(discovery_router)
app.include_router(graph_router)
app.include_router(scheduler_router)
app.include_router(topics_router)
app.include_router(subtopics_router)
app.include_router(tweets_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
