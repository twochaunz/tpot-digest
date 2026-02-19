from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.accounts import router as accounts_router
from app.routers.topics import router as topics_router
from app.routers.topics import subtopics_router
from app.routers.tweets import router as tweets_router

app = FastAPI(title="tpot-digest", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(accounts_router)
app.include_router(topics_router)
app.include_router(subtopics_router)
app.include_router(tweets_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
