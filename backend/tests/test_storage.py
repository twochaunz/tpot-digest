import json
from datetime import date
from pathlib import Path
from unittest.mock import patch

from app.storage import (
    slugify,
    get_date_dir,
    get_topic_dir,
    get_subtopic_dir,
    write_topic_metadata,
    write_subtopic_metadata,
    list_dates,
    list_topics_for_date,
)


def test_slugify():
    assert slugify("Claude 4 Launch!") == "claude-4-launch"
    assert slugify("OpenAI's Funding Round") == "openais-funding-round"
    assert slugify("  Spaces  and  Stuff  ") == "spaces-and-stuff"


def test_slugify_long():
    long_title = "A" * 200
    assert len(slugify(long_title)) <= 80


@patch("app.storage.settings")
def test_get_date_dir(mock_settings, tmp_path):
    mock_settings.data_dir = str(tmp_path)
    d = date(2026, 2, 19)
    result = get_date_dir(d)
    assert result.name == "20260219"
    assert result.exists()


@patch("app.storage.settings")
def test_get_topic_dir(mock_settings, tmp_path):
    mock_settings.data_dir = str(tmp_path)
    d = date(2026, 2, 19)
    result = get_topic_dir(d, "Claude 4 Launch", 1)
    assert result.name == "01-claude-4-launch"
    assert result.exists()


@patch("app.storage.settings")
def test_get_subtopic_dir(mock_settings, tmp_path):
    mock_settings.data_dir = str(tmp_path)
    d = date(2026, 2, 19)
    result = get_subtopic_dir(d, "Claude 4 Launch", 1, "Benchmark Analysis", 2)
    assert result.name == "02-benchmark-analysis"
    assert (result / "tweets").exists()
    assert (result / "articles").exists()


@patch("app.storage.settings")
def test_write_topic_metadata(mock_settings, tmp_path):
    mock_settings.data_dir = str(tmp_path)
    d = date(2026, 2, 19)
    path = write_topic_metadata(
        d, "Claude 4 Launch", 1,
        summary="Big launch day",
        tags=["launch", "AI"],
    )
    assert path.exists()
    data = json.loads(path.read_text())
    assert data["title"] == "Claude 4 Launch"
    assert data["tags"] == ["launch", "AI"]


@patch("app.storage.settings")
def test_write_subtopic_metadata(mock_settings, tmp_path):
    mock_settings.data_dir = str(tmp_path)
    d = date(2026, 2, 19)
    tweets = [{"tweet_id": "123", "author_handle": "karpathy", "text": "Amazing!"}]
    path = write_subtopic_metadata(
        d, "Claude 4 Launch", 1, "Hype", 1,
        summary="People excited",
        tweets=tweets,
    )
    assert path.exists()
    data = json.loads(path.read_text())
    assert len(data["tweets"]) == 1
    assert data["tweets"][0]["author"] == "karpathy"


@patch("app.storage.settings")
def test_list_dates(mock_settings, tmp_path):
    mock_settings.data_dir = str(tmp_path)
    (tmp_path / "20260219").mkdir()
    (tmp_path / "20260218").mkdir()
    (tmp_path / "not-a-date").mkdir()
    dates = list_dates(tmp_path)
    assert dates == ["20260219", "20260218"]


@patch("app.storage.settings")
def test_list_topics_for_date(mock_settings, tmp_path):
    mock_settings.data_dir = str(tmp_path)
    d = date(2026, 2, 19)
    write_topic_metadata(d, "Topic A", 1, summary="First")
    write_topic_metadata(d, "Topic B", 2, summary="Second")
    topics = list_topics_for_date(d, tmp_path)
    assert len(topics) == 2
    assert topics[0]["title"] == "Topic A"
