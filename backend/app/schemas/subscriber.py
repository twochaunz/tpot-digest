from datetime import datetime

from pydantic import BaseModel, EmailStr


class SubscribeRequest(BaseModel):
    email: EmailStr


class SubscribeResponse(BaseModel):
    message: str
    already_registered: bool = False


class SubscriberOut(BaseModel):
    id: int
    email: str
    unsubscribed_at: datetime | None
    subscribed_at: datetime

    model_config = {"from_attributes": True}


