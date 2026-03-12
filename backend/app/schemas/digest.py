import datetime as _dt

from pydantic import BaseModel


class DigestBlock(BaseModel):
    id: str
    type: str  # 'text' | 'topic-header' | 'tweet' | 'divider'
    content: str | None = None       # text blocks (supports markdown)
    topic_id: int | None = None      # topic-header blocks
    tweet_id: int | None = None      # tweet blocks (DB integer id)
    show_engagement: bool = False    # tweet blocks: show engagement metrics
    show_media: bool = True          # tweet blocks: show images/link cards
    show_quoted_tweet: bool = True   # tweet blocks: show quoted tweet embed


class GenerateTemplateRequest(BaseModel):
    date: str
    topic_ids: list[int]


class DigestDraftCreate(BaseModel):
    date: _dt.date
    content_blocks: list[DigestBlock] = []
    subject: str | None = None


class DigestDraftUpdate(BaseModel):
    content_blocks: list[DigestBlock] | None = None
    scheduled_for: _dt.datetime | None = None
    subject: str | None = None


class DigestDraftOut(BaseModel):
    id: int
    date: _dt.date
    content_blocks: list[dict]
    subject: str | None
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


class DigestSendRequest(BaseModel):
    subscriber_ids: list[int] | None = None


class DigestSendLogOut(BaseModel):
    id: int
    draft_id: int
    subscriber_id: int
    email: str
    status: str
    error_message: str | None
    resend_message_id: str | None
    attempted_at: _dt.datetime

    model_config = {"from_attributes": True}


class SendStatusOut(BaseModel):
    previously_sent: bool
    sent_count: int
    sent_at: _dt.datetime | None
    sent_subscriber_ids: list[int]


class DigestRetryRequest(BaseModel):
    subscriber_ids: list[int] | None = None
