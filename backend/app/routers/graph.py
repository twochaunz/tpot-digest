from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.topic import Topic, TopicEdge
from app.schemas.graph import GraphEdge, GraphNode, GraphResponse, ManualLinkRequest

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("", response_model=GraphResponse)
async def get_graph(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    tags: str | None = Query(None),
    entity: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Topic)

    if date_from is not None:
        stmt = stmt.where(Topic.date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Topic.date <= date_to)
    if entity is not None:
        stmt = stmt.where(
            or_(
                Topic.title.ilike(f"%{entity}%"),
                Topic.summary.ilike(f"%{entity}%"),
            )
        )

    result = await db.execute(stmt)
    topics = list(result.scalars().all())

    # Filter by tags in Python (JSONB not supported in SQLite)
    if tags is not None:
        requested_tags = [t.strip() for t in tags.split(",") if t.strip()]
        filtered = []
        for topic in topics:
            if topic.tags:
                topic_tag_values = set(topic.tags.keys()) | set(str(v) for v in topic.tags.values())
                if any(rt in topic_tag_values for rt in requested_tags):
                    filtered.append(topic)
        topics = filtered

    node_ids = {topic.id for topic in topics}

    # Fetch edges where both endpoints are in the filtered node set
    edges: list[TopicEdge] = []
    if node_ids:
        edge_stmt = select(TopicEdge).where(
            TopicEdge.source_topic_id.in_(node_ids),
            TopicEdge.target_topic_id.in_(node_ids),
        )
        edge_result = await db.execute(edge_stmt)
        edges = list(edge_result.scalars().all())

    return GraphResponse(
        nodes=[GraphNode.model_validate(t) for t in topics],
        edges=[GraphEdge.model_validate(e) for e in edges],
    )


@router.get("/search", response_model=list[GraphNode])
async def search_topics(
    q: str = Query(..., description="Search query string"),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Topic)
        .where(
            or_(
                Topic.title.ilike(f"%{q}%"),
                Topic.summary.ilike(f"%{q}%"),
            )
        )
        .order_by(Topic.date.desc())
        .limit(20)
    )
    result = await db.execute(stmt)
    topics = result.scalars().all()
    return [GraphNode.model_validate(t) for t in topics]


@router.post("/link", response_model=GraphEdge, status_code=201)
async def manual_link_topics(
    body: ManualLinkRequest,
    db: AsyncSession = Depends(get_db),
):
    source = await db.get(Topic, body.source_topic_id)
    if not source:
        raise HTTPException(404, f"Topic {body.source_topic_id} not found")

    target = await db.get(Topic, body.target_topic_id)
    if not target:
        raise HTTPException(404, f"Topic {body.target_topic_id} not found")

    edge = TopicEdge(
        source_topic_id=body.source_topic_id,
        target_topic_id=body.target_topic_id,
        relationship_type=body.relationship_type,
        strength=1.0,
    )
    db.add(edge)
    await db.commit()
    await db.refresh(edge)
    return GraphEdge.model_validate(edge)
