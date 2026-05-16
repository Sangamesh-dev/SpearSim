from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional
from app.database import get_supabase_admin
from app.rbac import require_viewer
from app.config import get_settings
from app.services.audit_service import log_action, AuditAction
from app.utils import get_client_ip

router = APIRouter(prefix="/api/profile", tags=["profile"])
settings = get_settings()


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None


@router.get("/")
async def get_profile(_user: dict = Depends(require_viewer)):
    try:
        db = get_supabase_admin()
        org_name = ""
        org_domain = ""
        if _user.get("org_id"):
            org = db.table("organizations").select("name, domain").eq("id", _user["org_id"]).maybe_single().execute()
            if org and org.data:
                org_name = org.data["name"]
                org_domain = org.data.get("domain", "")

        return {
            "id": _user["id"],
            "email": _user["email"],
            "org_id": _user["org_id"],
            "org_name": org_name,
            "org_domain": org_domain,
            "role": _user["role"],
            "full_name": _user.get("full_name", ""),
            "terms_accepted": _user.get("terms_accepted", False)
        }
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/")
async def update_profile(payload: ProfileUpdate, _user: dict = Depends(require_viewer)):
    try:
        update_data = {}
        if payload.full_name is not None:
            update_data["full_name"] = payload.full_name.strip()
        if not update_data:
            raise HTTPException(status_code=400, detail="Nothing to update")

        db = get_supabase_admin()
        db.table("user_profiles").update(update_data).eq("id", _user["id"]).execute()

        return {"success": True, "message": "Profile updated", "full_name": update_data.get("full_name")}
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


@router.post("/terms-consent")
async def accept_terms_consent(request: Request, _user: dict = Depends(require_viewer)):
    try:
        now_str = datetime.now(timezone.utc).isoformat()
        await log_action(
            actor_email=_user["email"],
            action=AuditAction.TERMS_ACCEPTED,
            target_table="user_profiles",
            target_id=_user["id"],
            ip_address=get_client_ip(request),
            metadata={"user_agent": request.headers.get("user-agent"), "terms_accepted_at": now_str},
            org_id=_user.get("org_id"),
        )
        return {"success": True, "terms_accepted": True, "terms_accepted_at": now_str}
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)
