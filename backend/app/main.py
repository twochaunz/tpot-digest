from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


@app.get("/api/health")
async def health():
    return {"status": "ok"}
