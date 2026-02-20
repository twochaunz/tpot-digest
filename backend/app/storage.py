import json
import re
from datetime import date
from pathlib import Path

from app.config import settings


def slugify(text: str) -> str:
    """Convert text to filesystem-safe slug."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text[:80]  # Max 80 chars


def get_data_dir() -> Path:
    return Path(settings.data_dir)


def get_date_dir(d: date) -> Path:
    """Get or create the directory for a specific date."""
    date_str = d.strftime("%Y%m%d")
    path = get_data_dir() / date_str
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_topic_dir(d: date, topic_title: str, rank: int) -> Path:
    """Get or create a topic directory with numbered prefix."""
    date_dir = get_date_dir(d)
    slug = slugify(topic_title)
    dir_name = f"{rank:02d}-{slug}"
    path = date_dir / dir_name
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_subtopic_dir(d: date, topic_title: str, topic_rank: int, subtopic_title: str, subtopic_rank: int) -> Path:
    """Get or create a subtopic directory within a topic."""
    topic_dir = get_topic_dir(d, topic_title, topic_rank)
    slug = slugify(subtopic_title)
    dir_name = f"{subtopic_rank:02d}-{slug}"
    path = topic_dir / dir_name
    path.mkdir(parents=True, exist_ok=True)

    # Ensure tweets and articles subdirs exist
    (path / "tweets").mkdir(exist_ok=True)
    (path / "articles").mkdir(exist_ok=True)

    return path


def write_topic_metadata(
    d: date,
    topic_title: str,
    topic_rank: int,
    summary: str | None = None,
    subtopics: list[dict] | None = None,
    lifecycle_status: str = "emerging",
    sentiment: str | None = None,
    tags: list[str] | None = None,
) -> Path:
    """Write metadata.json for a topic directory."""
    topic_dir = get_topic_dir(d, topic_title, topic_rank)
    metadata = {
        "title": topic_title,
        "date": d.isoformat(),
        "rank": topic_rank,
        "summary": summary,
        "lifecycle_status": lifecycle_status,
        "sentiment": sentiment,
        "tags": tags or [],
        "subtopics": [st.get("title", "") for st in (subtopics or [])],
    }
    metadata_path = topic_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2))
    return metadata_path


def write_subtopic_metadata(
    d: date,
    topic_title: str,
    topic_rank: int,
    subtopic_title: str,
    subtopic_rank: int,
    summary: str | None = None,
    sentiment: str | None = None,
    tweets: list[dict] | None = None,
) -> Path:
    """Write metadata.json for a subtopic directory."""
    subtopic_dir = get_subtopic_dir(d, topic_title, topic_rank, subtopic_title, subtopic_rank)
    metadata = {
        "title": subtopic_title,
        "summary": summary,
        "sentiment": sentiment,
        "tweets": [
            {
                "tweet_id": t.get("tweet_id"),
                "author": t.get("author_handle"),
                "text": t.get("text", "")[:280],
                "screenshot": t.get("screenshot_path"),
            }
            for t in (tweets or [])
        ],
    }
    metadata_path = subtopic_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2))
    return metadata_path


def list_dates(data_dir: Path | None = None) -> list[str]:
    """List all date directories in the data folder, sorted descending."""
    root = data_dir or get_data_dir()
    if not root.exists():
        return []
    dates = [
        d.name for d in root.iterdir()
        if d.is_dir() and re.match(r'^\d{8}$', d.name)
    ]
    return sorted(dates, reverse=True)


def list_topics_for_date(d: date, data_dir: Path | None = None) -> list[dict]:
    """List topic directories for a given date with their metadata."""
    root = data_dir or get_data_dir()
    date_str = d.strftime("%Y%m%d")
    date_dir = root / date_str

    if not date_dir.exists():
        return []

    topics = []
    for topic_dir in sorted(date_dir.iterdir()):
        if not topic_dir.is_dir():
            continue
        metadata_path = topic_dir / "metadata.json"
        if metadata_path.exists():
            metadata = json.loads(metadata_path.read_text())
            metadata["dir_name"] = topic_dir.name
            metadata["path"] = str(topic_dir)
            topics.append(metadata)

    return topics
