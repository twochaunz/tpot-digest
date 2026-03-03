import datetime as _dt

from pydantic import BaseModel


class DigestDraftCreate(BaseModel):
    date: _dt.date
    topic_ids: list[int] = []
    intro_text: str | None = None


class DigestDraftUpdate(BaseModel):
    intro_text: str | None = None
    topic_ids: list[int] | None = None
    topic_notes: dict[str, str] | None = None
    scheduled_for: _dt.datetime | None = None


class DigestDraftOut(BaseModel):
    id: int
    date: _dt.date
    topic_ids: list[int]
    topic_notes: dict | None
    intro_text: str | None
    status: str
    scheduled_for: _dt.datetime | None
    sent_at: _dt.datetime | None
    recipient_count: int | None
    created_at: _dt.datetime
    updated_at: _dt.datetime

    model_config = {"from_attributes": True}


class DigestPreview(BaseModel):
    subject: str
    html: str
    recipient_count: int


class DigestSendTestRequest(BaseModel):
    email: str | None = None
