from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.pipeline.discovery import discover_accounts, approve_discovery, reject_discovery

router = APIRouter(prefix="/api/discovery", tags=["discovery"])


@router.get("")
async def get_suggestions(
    min_appearances: int = Query(3),
    max_suggestions: int = Query(10),
    db: AsyncSession = Depends(get_db),
):
    return await discover_accounts(db, min_appearances, max_suggestions)


@router.post("/approve")
async def approve(handle: str = Query(...), priority: int = Query(3), db: AsyncSession = Depends(get_db)):
    account = await approve_discovery(db, handle, priority)
    return {"id": account.id, "handle": account.handle, "source": account.source.value, "is_active": account.is_active}


@router.post("/reject")
async def reject(handle: str = Query(...), db: AsyncSession = Depends(get_db)):
    account = await reject_discovery(db, handle)
    return {"id": account.id, "handle": account.handle, "is_blocked": account.is_blocked}
