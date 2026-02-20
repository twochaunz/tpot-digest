from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.accounts import router as accounts_router
from app.routers.assets import router as assets_router
from app.routers.auth import router as auth_router
from app.routers.discovery import router as discovery_router
from app.routers.graph import router as graph_router
from app.routers.ingest import router as ingest_router
from app.routers.scheduler import router as scheduler_router
from app.routers.topics import router as topics_router
from app.routers.topics import subtopics_router
from app.routers.tweets import router as tweets_router


app = FastAPI(title="tpot-digest", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(accounts_router)
app.include_router(assets_router)
app.include_router(auth_router)
app.include_router(discovery_router)
app.include_router(graph_router)
app.include_router(ingest_router)
app.include_router(scheduler_router)
app.include_router(topics_router)
app.include_router(subtopics_router)
app.include_router(tweets_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
