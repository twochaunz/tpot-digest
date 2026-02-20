from pydantic import BaseModel


class CategoryCreate(BaseModel):
    name: str
    color: str | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    position: int | None = None


class CategoryOut(BaseModel):
    id: int
    name: str
    color: str | None
    position: int

    model_config = {"from_attributes": True}
