from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=30,
    pool_pre_ping=True,
)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


@event.listens_for(Base, "init", propagate=True)
def _apply_column_defaults(target, args, kwargs):
    """Apply column-level defaults to Python objects at construction time."""
    for col_attr in target.__class__.__mapper__.column_attrs:
        col = col_attr.columns[0]
        if col_attr.key not in kwargs and col.default is not None:
            if hasattr(col.default, "arg") and not callable(col.default.arg):
                kwargs[col_attr.key] = col.default.arg


async def get_db():
    async with async_session() as session:
        yield session
