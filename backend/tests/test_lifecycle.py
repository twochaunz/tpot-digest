import pytest
from app.pipeline.lifecycle import compute_lifecycle_status


def test_emerging_to_trending_by_velocity():
    assert compute_lifecycle_status(velocity=150, prev_status="emerging") == "trending"


def test_emerging_to_trending_by_count():
    assert compute_lifecycle_status(velocity=50, prev_status="emerging", tweet_count=5) == "trending"


def test_emerging_stays_emerging():
    assert compute_lifecycle_status(velocity=30, prev_status="emerging", tweet_count=2) == "emerging"


def test_trending_to_peaked():
    assert compute_lifecycle_status(velocity=-10, prev_status="trending") == "peaked"


def test_trending_stays_trending():
    assert compute_lifecycle_status(velocity=200, prev_status="trending") == "trending"


def test_peaked_to_fading():
    assert compute_lifecycle_status(velocity=-60, prev_status="peaked") == "fading"


def test_peaked_resurge():
    assert compute_lifecycle_status(velocity=150, prev_status="peaked") == "trending"


def test_peaked_stays_peaked():
    assert compute_lifecycle_status(velocity=-20, prev_status="peaked") == "peaked"


def test_fading_resurge():
    assert compute_lifecycle_status(velocity=150, prev_status="fading") == "emerging"


def test_fading_stays_fading():
    assert compute_lifecycle_status(velocity=10, prev_status="fading") == "fading"
