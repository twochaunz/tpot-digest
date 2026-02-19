from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://tpot:***REMOVED***@localhost:5432/tpot_digest"
    data_dir: str = "./data"

    model_config = {"env_file": ".env"}


settings = Settings()
