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

from app.routers.scripts import router as scripts_router
app.include_router(scripts_router)

from app.auth import router as auth_router
app.include_router(auth_router)

from app.routers.subscribers import router as subscribers_router
app.include_router(subscribers_router)

from app.routers.digest import router as digest_router
app.include_router(digest_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


import math
import re
import httpx


def _tweet_token(tweet_id: str) -> str:
    """Replicate react-tweet's getToken: (id/1e15*PI).toString(36), strip dots/zeros."""
    num = int(tweet_id) / 1e15 * math.pi
    # Float to base-36 string (matching JS Number.toString(36))
    integer_part = int(num)
    frac = num - integer_part
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    result = digits[integer_part] if integer_part < 36 else ""
    if integer_part >= 36:
        s = ""
        n = integer_part
        while n:
            s = digits[n % 36] + s
            n //= 36
        result = s
    result += "."
    for _ in range(20):
        frac *= 36
        d = int(frac)
        result += digits[d]
        frac -= d
    return re.sub(r"(0+|\.)", "", result)


@app.get("/api/image-proxy")
async def image_proxy(url: str):
    """Proxy external images to avoid CORS issues in html-to-image captures."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(url, timeout=10)
    from fastapi.responses import Response
    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/api/tweet-embed/{tweet_id}")
async def tweet_embed_proxy(tweet_id: str):
    """Proxy Twitter syndication API for react-tweet (their Vercel proxy returns stale data)."""
    token = _tweet_token(tweet_id)
    url = f"https://cdn.syndication.twimg.com/tweet-result?id={tweet_id}&lang=en&token={token}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
    return {"data": resp.json()}

app.mount("/api/screenshots", StaticFiles(directory=settings.data_dir), name="screenshots")
