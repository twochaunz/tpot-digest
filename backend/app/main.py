from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers.tweets import router as tweets_router

app = FastAPI(title="tpot-digest", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tweets_router)

from app.routers.topics import router as topics_router
app.include_router(topics_router)

from app.routers.days import router as days_router
app.include_router(days_router)

from app.routers.waitlist import router as waitlist_router
app.include_router(waitlist_router)

from app.routers.scripts import router as scripts_router
app.include_router(scripts_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}

app.mount("/api/screenshots", StaticFiles(directory=settings.data_dir), name="screenshots")
