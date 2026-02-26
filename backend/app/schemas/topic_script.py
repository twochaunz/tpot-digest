from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ScriptBlock(BaseModel):
    type: str  # "text" or "tweet"
    text: str | None = None
    tweet_id: str | None = None


class ScriptGenerateRequest(BaseModel):
    model: str = "grok-4-1-fast-reasoning"
    feedback: str | None = None
    fetch_grok_context: bool = True


class ScriptOut(BaseModel):
    id: int
    topic_id: int
    version: int
    model_used: str
    content: list[ScriptBlock]
    feedback: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ScriptVersionSummary(BaseModel):
    id: int
    version: int
    model_used: str
    feedback: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ScriptContentUpdate(BaseModel):
    content: list[ScriptBlock]


class DayScriptGenerateRequest(BaseModel):
    model: str = "grok-4-1-fast-reasoning"
    fetch_grok_context: bool = True
    topic_ids: list[int] | None = None  # None = all topics
