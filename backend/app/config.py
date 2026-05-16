"""
Application configuration — loads settings from environment variables via pydantic-settings.
Only contains the Settings class and get_settings() factory.
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # Groq
    groq_api_key: str
    groq_model: str = "llama-3.3-70b-versatile"

    # SendGrid
    sendgrid_api_key: str
    sendgrid_from_email: str
    sendgrid_from_name: str = "PhishSim Security Team"

    # App
    app_base_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:3000"
    secret_key: str
    environment: str = "development"

    # CORS
    allowed_origins: str = "http://localhost:3000,http://localhost:5173"

    # Auth — Supabase JWT
    supabase_jwt_secret: str = ""
    jwt_algorithm: str = "HS256"

    # Background queue
    redis_url: str = "redis://localhost:6379/0"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
