from pydantic import BaseModel


class AccountCreate(BaseModel):
    handle: str
    display_name: str | None = None
    source: str = "seed"
    priority: int = 2


class AccountUpdate(BaseModel):
    display_name: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    is_blocked: bool | None = None
    is_boosted: bool | None = None
    frequency_cap: int | None = None


class AccountOut(BaseModel):
    id: int
    handle: str
    display_name: str | None
    source: str
    priority: int
    is_active: bool
    is_blocked: bool
    is_boosted: bool
    follower_count: int | None

    model_config = {"from_attributes": True}
