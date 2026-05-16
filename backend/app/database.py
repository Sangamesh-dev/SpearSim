from supabase import create_client, Client
from app.config import get_settings
from functools import lru_cache

settings = get_settings()


@lru_cache()
def get_supabase() -> Client:
    """Authenticated client using anon key (respects RLS)."""
    return create_client(settings.supabase_url, settings.supabase_anon_key)


@lru_cache()
def get_supabase_admin() -> Client:
    """Service role client — bypasses RLS. Use only for system operations."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
