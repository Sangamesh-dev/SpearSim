"""
Organization management routes.
"""
from fastapi import APIRouter, HTTPException, Request, Depends
from app.models import OrganizationCreate, OrganizationResponse
from app.database import get_supabase_admin
from app.services.audit_service import log_action, AuditAction
from app.utils import get_client_ip
from app.rbac import require_analyst, require_viewer
from app.config import get_settings

router = APIRouter(prefix="/api/organizations", tags=["organizations"])
settings = get_settings()


@router.post("/", response_model=OrganizationResponse)
async def create_organization(payload: OrganizationCreate, request: Request, _user: dict = Depends(require_analyst)):
    try:
        db = get_supabase_admin()

        # Check for duplicate domain
        existing = db.table("organizations").select("id").eq("domain", payload.domain).execute()
        if existing and existing.data:
            raise HTTPException(status_code=409, detail=f"Organization with domain '{payload.domain}' already exists")

        result = db.table("organizations").insert({
            "name": payload.name,
            "domain": payload.domain.lower().strip(),
        }).execute()

        org = result.data[0]

        # Auto-create user profile linking creator to new org as admin
        # Use upsert to avoid conflict if a profile was already created during auth
        db.table("user_profiles").upsert({
            "id": _user["id"],
            "org_id": org["id"],
            "role": "admin",
            "full_name": _user.get("full_name", "")
        }).execute()

        await log_action(
            actor_email=_user["email"],
            action=AuditAction.ORG_CREATE,
            target_table="organizations",
            target_id=org["id"],
            ip_address=get_client_ip(request),
            metadata={"name": payload.name, "domain": payload.domain},
        )

        return OrganizationResponse(**org)

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


@router.get("/", response_model=list[OrganizationResponse])
async def list_organizations(request: Request, _user: dict = Depends(require_viewer)):
    try:
        db = get_supabase_admin()
        result = db.table("organizations").select("*").eq("id", _user["org_id"]).order("name").execute()
        return [OrganizationResponse(**o) for o in (result.data or [])]
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_organization(org_id: str, request: Request, _user: dict = Depends(require_viewer)):
    try:
        if org_id != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")
            
        db = get_supabase_admin()
        result = db.table("organizations").select("*").eq("id", org_id).maybe_single().execute()
        if not result or not result.data:
            raise HTTPException(status_code=404, detail="Organization not found")
        return OrganizationResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)
