from datetime import date

from pydantic import BaseModel


class GraphNode(BaseModel):
    id: int
    title: str
    date: date
    lifecycle_status: str
    sentiment: str | None
    tags: dict | None
    summary: str | None

    model_config = {"from_attributes": True}


class GraphEdge(BaseModel):
    id: int
    source_topic_id: int
    target_topic_id: int
    relationship_type: str
    strength: float

    model_config = {"from_attributes": True}


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class ManualLinkRequest(BaseModel):
    source_topic_id: int
    target_topic_id: int
    relationship_type: str = "manual"
