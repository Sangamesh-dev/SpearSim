from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.database import get_supabase_admin
from app.rbac import require_admin
from app.config import get_settings

router = APIRouter(prefix="/api", tags=["invite"])
settings = get_settings()

class InviteRequest(BaseModel):
    email: str
    role: str

class RoleUpdate(BaseModel):
    role: str

@router.post("/invite")
async def invite_member(payload: InviteRequest, _user: dict = Depends(require_admin)):
    try:
        if payload.role not in {"admin", "analyst", "viewer"}:
            raise HTTPException(status_code=400, detail="Invalid role")

        db = get_supabase_admin()
        
        # 1. Invite via Auth Admin API
        res = db.auth.admin.invite_user_by_email(payload.email)
        if not res or not res.user:
            raise HTTPException(status_code=400, detail="Failed to send invite")
            
        user_id = res.user.id
        
        # 2. Add profile linking to org
        db.table("user_profiles").upsert({
            "id": user_id,
            "org_id": _user["org_id"],
            "role": payload.role,
            "full_name": ""
        }).execute()
        
        return {"message": f"Invite sent to {payload.email}"}
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)

@router.get("/invite/members")
async def list_members(_user: dict = Depends(require_admin)):
    try:
        db = get_supabase_admin()
        # To get the email, we might have to query auth.users if we don't store it in user_profiles.
        # But auth.users is not queryable directly via postgrest easily without a view.
        # Let's get the auth users list via admin API and merge.
        
        profiles = db.table("user_profiles").select("*").eq("org_id", _user["org_id"]).execute()
        profile_map = {p["id"]: p for p in (profiles.data or [])}
        
        # Fetch all auth users (paginated if many, but we'll assume a small number for now)
        auth_users = db.auth.admin.list_users()
        
        members = []
        for u in auth_users:
            if u.id in profile_map:
                p = profile_map[u.id]
                members.append({
                    "id": u.id,
                    "email": u.email,
                    "full_name": p.get("full_name", ""),
                    "role": p.get("role", "viewer"),
                    "created_at": p.get("created_at")
                })
                
        return members
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)

@router.put("/invite/members/{user_id}/role")
async def update_member_role(user_id: str, payload: RoleUpdate, _user: dict = Depends(require_admin)):
    try:
        if payload.role not in {"admin", "analyst", "viewer"}:
            raise HTTPException(status_code=400, detail="Invalid role")
            
        db = get_supabase_admin()
        profile = db.table("user_profiles").select("org_id").eq("id", user_id).maybe_single().execute()
        if not profile or not profile.data or profile.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=404, detail="Member not found in your organization")
            
        db.table("user_profiles").update({"role": payload.role}).eq("id", user_id).execute()
        return {"message": "Role updated"}
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)

@router.delete("/invite/members/{user_id}")
async def remove_member(user_id: str, _user: dict = Depends(require_admin)):
    try:
        if user_id == _user["id"]:
            raise HTTPException(status_code=400, detail="Cannot remove yourself")
            
        db = get_supabase_admin()
        profile = db.table("user_profiles").select("org_id").eq("id", user_id).maybe_single().execute()
        if not profile or not profile.data or profile.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=404, detail="Member not found in your organization")
            
        db.table("user_profiles").delete().eq("id", user_id).execute()
        return {"message": "Member removed"}
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)
