from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://tpot:***REMOVED***@localhost:5432/tpot_digest"
    data_dir: str = "./data"
    scrape_interval_hours: int = 2
    scrape_max_scrolls: int = 10

    model_config = {"env_file": ".env"}


settings = Settings()
