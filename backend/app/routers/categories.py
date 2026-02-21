from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.category import Category
from app.schemas.category import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(prefix="/api/categories", tags=["categories"])


CATEGORY_COLORS = [
    '#6366f1', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6',
    '#ef4444', '#06b6d4', '#8b5cf6', '#f97316', '#14b8a6',
]


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryCreate, db: AsyncSession = Depends(get_db)):
    # Return existing category if name already exists
    existing = await db.execute(select(Category).where(Category.name == body.name))
    found = existing.scalar_one_or_none()
    if found:
        return found

    # Auto-assign color if not provided
    color = body.color
    if not color:
        count_result = await db.execute(select(Category))
        count = len(count_result.scalars().all())
        color = CATEGORY_COLORS[count % len(CATEGORY_COLORS)]

    category = Category(name=body.name, color=color)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.get("", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Category).order_by(Category.position))
    return result.scalars().all()


@router.patch("/{category_id}", response_model=CategoryOut)
async def update_category(category_id: int, body: CategoryUpdate, db: AsyncSession = Depends(get_db)):
    category = await db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "Category not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=204)
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)):
    category = await db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "Category not found")
    await db.delete(category)
    await db.commit()
