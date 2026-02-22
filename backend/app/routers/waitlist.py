from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.waitlist import WaitlistEntry
from app.schemas.waitlist import WaitlistRequest, WaitlistResponse

router = APIRouter(prefix="/api/waitlist", tags=["waitlist"])


@router.post("", response_model=WaitlistResponse)
async def join_waitlist(body: WaitlistRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(WaitlistEntry).where(WaitlistEntry.email == body.email)
    )).scalar_one_or_none()

    if existing:
        return WaitlistResponse(message="You're already on the list!", already_registered=True)

    entry = WaitlistEntry(email=body.email)
    db.add(entry)
    await db.commit()
    return WaitlistResponse(message="You're on the list!")
