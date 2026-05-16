"""
JWT authentication for PhishSim.
Validates Supabase-issued JWTs and extracts user identity + role.
"""
from typing import Optional
from fastapi import Depends, HTTPException, Header, Request
import httpx
from app.config import get_settings
from app.database import get_supabase_admin

settings = get_settings()

VALID_ROLES = {"admin", "analyst", "viewer"}


async def get_current_user(request: Request, authorization: Optional[str] = Header(None)) -> dict:
    """
    Extract and verify the Bearer JWT from the Authorization header.
    Returns a dict with: id, email, role.
    Raises HTTP 401 if the token is missing or invalid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        print(f"Auth header missing or invalid: {authorization}")
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header. Expected: Bearer <token>",
        )

    token = authorization.removeprefix("Bearer ").strip()

    if not settings.supabase_jwt_secret:
        if settings.environment != "development":
            raise HTTPException(status_code=500, detail="Server misconfiguration: auth not initialised")
        return {"id": "dev", "email": "dev@localhost", "role": "admin", "terms_accepted": True}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.supabase_url}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": settings.supabase_anon_key
                }
            )
            
            if resp.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid token")
                
            user_data = resp.json()
            user_id = user_data.get("id")
            email = user_data.get("email")
            user_metadata = user_data.get("user_metadata") or {}
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Auth verification failed: {e}")
        detail = f"Invalid token: {e}" if settings.environment == "development" else "Invalid token"
        raise HTTPException(status_code=401, detail=detail)

    # Query user profile for org_id
    db = get_supabase_admin()
    profile_result = db.table("user_profiles").select("org_id, role, full_name").eq("id", user_id).maybe_single().execute()
    
    # Check if terms have been accepted via audit_logs
    terms_res = db.table("audit_logs").select("id").eq("actor_email", email).eq("action", "USER_TERMS_ACCEPTED").limit(1).execute()
    terms_accepted = bool(terms_res and terms_res.data)

    if not profile_result or not profile_result.data:
        role = user_metadata.get("role", "analyst")
        full_name = user_metadata.get("full_name", "")
        
        # Check if an organization exists matching the user's email domain
        domain = email.split("@")[1].lower().strip() if email and "@" in email else ""
        if domain:
            org_res = db.table("organizations").select("id").eq("domain", domain).maybe_single().execute()
            if org_res and org_res.data:
                org_id = org_res.data["id"]
                # Auto-create profile
                db.table("user_profiles").insert({
                    "id": user_id,
                    "org_id": org_id,
                    "role": role,
                    "full_name": full_name
                }).execute()
                return {
                    "id": user_id,
                    "email": email,
                    "org_id": org_id,
                    "role": role,
                    "full_name": full_name,
                    "terms_accepted": terms_accepted
                }

        # Allow creating an org if they don't have a profile or matching org yet
        if request.url.path.rstrip("/").endswith("/api/organizations") and request.method == "POST":
            return {
                "id": user_id,
                "email": email,
                "org_id": None,
                "role": role,
                "full_name": full_name,
                "terms_accepted": terms_accepted
            }
        raise HTTPException(status_code=403, detail="User has no organisation assigned. Contact your administrator.")

    profile = profile_result.data
    
    return {
        "id": user_id,
        "email": email,
        "org_id": profile["org_id"],
        "role": profile["role"],
        "full_name": profile.get("full_name", ""),
        "terms_accepted": terms_accepted
    }
