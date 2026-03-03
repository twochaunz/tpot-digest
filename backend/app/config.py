from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://tpot:tpot_dev@localhost:5432/tpot_digest"
    data_dir: str = "./data"
    x_api_bearer_token: str = ""
    xai_api_key: str = ""
    anthropic_api_key: str = ""
    admin_secret: str = ""
    resend_api_key: str = ""
    from_email: str = "tpot digest <digest@tpot.wonchan.com>"
    admin_email: str = ""

    model_config = {"env_file": ".env"}


settings = Settings()
