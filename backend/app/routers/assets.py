import io
import zipfile
from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.storage import list_dates, list_topics_for_date, get_data_dir

router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.get("/dates")
async def get_dates():
    """List all available dates."""
    return {"dates": list_dates()}


@router.get("/browse/{date_str}")
async def browse_date(date_str: str):
    """Browse topics and assets for a given date."""
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD.")

    topics = list_topics_for_date(d)

    # Enrich with file listings
    for topic in topics:
        topic_path = Path(topic["path"])
        topic["subtopics_detail"] = []
        for subdir in sorted(topic_path.iterdir()):
            if not subdir.is_dir():
                continue
            tweets_dir = subdir / "tweets"
            articles_dir = subdir / "articles"
            subtopic_info = {
                "name": subdir.name,
                "path": str(subdir),
                "tweets": [
                    {"name": f.name, "path": str(f)}
                    for f in sorted(tweets_dir.iterdir()) if f.is_file()
                ] if tweets_dir.exists() else [],
                "articles": [
                    {"name": f.name, "path": str(f)}
                    for f in sorted(articles_dir.iterdir()) if f.is_file()
                ] if articles_dir.exists() else [],
            }
            topic["subtopics_detail"].append(subtopic_info)

    return {"date": date_str, "topics": topics}


class DownloadRequest(BaseModel):
    paths: list[str]


@router.post("/download")
async def download_assets(body: DownloadRequest):
    """Bulk download selected assets as a zip file."""
    data_dir = get_data_dir()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in body.paths:
            p = Path(file_path)
            # Security: ensure path is within data directory
            try:
                p.resolve().relative_to(data_dir.resolve())
            except ValueError:
                continue  # Skip paths outside data dir
            if p.is_file():
                arcname = str(p.relative_to(data_dir))
                zf.write(p, arcname)

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=assets.zip"},
    )
