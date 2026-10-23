from pydantic import ValidationError
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Deliberately has no default: the database URL (and therefore the DB
    # password) must come from the environment or backend/.env, never from
    # source. docker-compose sets DATABASE_URL from DB_USER/DB_PASSWORD.
    database_url: str
    data_dir: str = "./data"
    x_api_bearer_token: str = ""
    twitter_api_io_key: str = ""
    xai_api_key: str = ""
    anthropic_api_key: str = ""
    admin_secret: str = ""
    resend_api_key: str = ""
    digest_from_email: str = "abridged tech <read@abridged.tech>"
    digest_reply_to_email: str = "hi@wonchan.com"
    admin_email: str = ""
    openrouter_api_key: str = ""
    resend_webhook_secret: str = ""

    model_config = {"env_file": ".env"}


try:
    settings = Settings()
except ValidationError as exc:
    if any(err.get("loc") == ("database_url",) for err in exc.errors()):
        raise RuntimeError(
            "DATABASE_URL is not set. Export it or add it to backend/.env, e.g. "
            "DATABASE_URL=postgresql+asyncpg://tpot:<password>@localhost:5432/tpot_digest "
            "(when running under docker compose, set DB_PASSWORD instead; see .env.example)."
        ) from exc
    raise
