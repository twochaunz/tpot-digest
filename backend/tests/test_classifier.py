import pytest
from unittest.mock import MagicMock

from app.services.classifier import _build_category_summary, classify_pipeline, recategorize_topic_tweets


def test_build_category_summary():
    assignments = [
        MagicMock(category="context"),
        MagicMock(category="context"),
        MagicMock(category="pushback"),
        MagicMock(category=None),
    ]
    result = _build_category_summary(assignments)
    assert "2 context" in result
    assert "1 pushback" in result


def test_build_category_summary_empty():
    result = _build_category_summary([])
    assert result == "no categorized tweets"


def test_build_category_summary_all_none():
    assignments = [MagicMock(category=None), MagicMock(category=None)]
    result = _build_category_summary(assignments)
    assert result == "no categorized tweets"


def test_pipeline_functions_exist():
    """Verify the pipeline functions exist and are callable."""
    assert callable(classify_pipeline)
    assert callable(recategorize_topic_tweets)
