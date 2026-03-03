import datetime as _dt

from pydantic import BaseModel


class DigestBlock(BaseModel):
    id: str
    type: str  # 'text' | 'topic'
    content: str | None = None    # text blocks
    topic_id: int | None = None   # topic blocks
    note: str | None = None       # topic blocks


class DigestDraftCreate(BaseModel):
    date: _dt.date
    content_blocks: list[DigestBlock] = []


class DigestDraftUpdate(BaseModel):
    content_blocks: list[DigestBlock] | None = None
    scheduled_for: _dt.datetime | None = None


class DigestDraftOut(BaseModel):
    id: int
    date: _dt.date
    content_blocks: list[dict]
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
