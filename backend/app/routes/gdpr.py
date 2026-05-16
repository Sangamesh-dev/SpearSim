"""
GDPR compliance routes.
- Right to erasure (Article 17)
- Audit log viewer (Article 30)
- Consent PDF generation
"""
import io
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query, Depends
from fastapi.responses import StreamingResponse

from app.models import ErasureResponse, AuditLogPage, ConsentPDFRequest, SuccessResponse
from app.database import get_supabase_admin
from app.services.audit_service import log_action, AuditAction
from app.services.pdf_service import (
    generate_authorization_pdf,
    generate_erasure_receipt_pdf,
)
from app.config import get_settings
from app.utils import get_client_ip
from app.rbac import require_admin

router = APIRouter(prefix="/api/gdpr", tags=["gdpr"])
settings = get_settings()


# ============================================================
# DELETE /api/gdpr/erase/{alias} — Article 17 Right to Erasure
# ============================================================
@router.delete("/erase/{alias}", response_model=ErasureResponse)
async def erase_employee(alias: str, request: Request, _user: dict = Depends(require_admin)):
    """
    Erase all data for an employee by alias.
    Deletes: employee record, all events, name_map entry.
    Logs erasure to audit_logs.
    """
    try:
        db = get_supabase_admin()

        # Find employee
        emp = db.table("employees").select("*, campaigns(org_id)").eq("alias", alias).execute()
        if not emp.data or len(emp.data) == 0:
            raise HTTPException(status_code=404, detail=f"No employee found with alias '{alias}'")
            
        employee = emp.data[0]
        if employee["campaigns"]["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        employee_id = employee["id"]
        campaign_id = employee["campaign_id"]

        records_deleted = {}

        # Delete events
        events_result = db.table("events").delete().eq("employee_id", employee_id).execute()
        records_deleted["events"] = len(events_result.data) if events_result.data else 0

        # Delete name_map entry
        name_result = db.table("name_map").delete().eq("alias", alias).execute()
        records_deleted["name_map"] = len(name_result.data) if name_result.data else 0

        # Delete employee record
        db.table("employees").delete().eq("id", employee_id).execute()
        records_deleted["employees"] = 1

        erased_at = datetime.now(timezone.utc)

        # Log erasure
        await log_action(
            actor_email=_user["email"],
            action=AuditAction.ERASURE_COMPLETE,
            target_table="employees",
            target_id=employee_id,
            ip_address=get_client_ip(request),
            metadata={
                "alias": alias,
                "campaign_id": campaign_id,
                "records_deleted": records_deleted,
                "erased_at": erased_at.isoformat(),
            },
            org_id=_user["org_id"],
        )

        return ErasureResponse(
            alias=alias,
            erased_at=erased_at,
            records_deleted=records_deleted,
            receipt_available=True,
        )

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/gdpr/erase/{alias}/receipt — Download erasure receipt PDF
# ============================================================
@router.get("/erase/{alias}/receipt")
async def download_erasure_receipt(
    alias: str,
    request: Request,
    campaign_id: str = Query(...),
    _user: dict = Depends(require_admin)
):
    """Download a PDF receipt for a completed erasure request."""
    try:
        db = get_supabase_admin()

        # Verify erasure was logged
        audit = db.table("audit_logs").select("*").eq(
            "action", AuditAction.ERASURE_COMPLETE
        ).eq("org_id", _user["org_id"]).contains("metadata", {"alias": alias}).order("timestamp", desc=True).limit(1).execute()

        erased_at = datetime.now(timezone.utc)
        records_deleted = {"employees": 1, "events": "N/A", "name_map": "N/A"}

        if audit and audit.data:
            entry = audit.data[0]
            erased_at = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
            records_deleted = entry.get("metadata", {}).get("records_deleted", records_deleted)

        pdf_bytes = generate_erasure_receipt_pdf(
            alias=alias,
            erased_at=erased_at,
            records_deleted=records_deleted,
            actor_email=_user["email"],
            campaign_id=campaign_id,
        )

        await log_action(
            actor_email=_user["email"],
            action=AuditAction.ERASURE_RECEIPT_DOWNLOAD,
            target_table="employees",
            target_id=alias,
            ip_address=get_client_ip(request),
            org_id=_user["org_id"],
        )

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=erasure-receipt-{alias}.pdf"},
        )
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/gdpr/audit-logs
# ============================================================
@router.get("/audit-logs", response_model=AuditLogPage)
async def get_audit_logs(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    action_filter: Optional[str] = Query(None),
    _user: dict = Depends(require_admin)
):
    """
    Paginated, filterable audit log viewer.
    Read-only — no delete endpoint exists.
    """
    try:
        db = get_supabase_admin()

        query = db.table("audit_logs").select("*", count="exact").eq("org_id", _user["org_id"])

        if action_filter:
            query = query.ilike("action", f"%{action_filter}%")

        offset = (page - 1) * page_size
        result = query.order("timestamp", desc=True).range(offset, offset + page_size - 1).execute()

        return AuditLogPage(
            items=result.data or [],
            total=result.count or 0,
            page=page,
            page_size=page_size,
        )
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# POST /api/gdpr/consent-pdf/{campaign_id}
# ============================================================
@router.post("/consent-pdf/{campaign_id}")
async def generate_consent_pdf(
    campaign_id: str,
    payload: ConsentPDFRequest,
    request: Request,
    _user: dict = Depends(require_admin),
):
    """Generate and download the authorization PDF for a campaign."""
    try:
        db = get_supabase_admin()

        campaign = db.table("campaigns").select("*").eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")
            
        if campaign.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        pdf_bytes = generate_authorization_pdf(
            org_name=payload.org_name,
            admin_email=payload.admin_email,
            campaign_name=payload.campaign_name,
            campaign_scope=payload.campaign_scope,
            lawful_basis=payload.lawful_basis.value,
            campaign_id=campaign_id,
        )

        await log_action(
            actor_email=payload.admin_email,
            action=AuditAction.CONSENT_PDF_DOWNLOAD,
            target_table="campaigns",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            metadata={"lawful_basis": payload.lawful_basis.value},
            org_id=_user["org_id"],
        )

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename=phishsim-authorization-{campaign_id[:8]}.pdf"
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/gdpr/active-campaigns — retention dashboard
# ============================================================
@router.get("/active-campaigns")
async def get_active_campaigns_retention(request: Request, _user: dict = Depends(require_admin)):
    """Return active campaigns with retention countdown."""
    try:
        db = get_supabase_admin()
        result = db.table("campaign_summary").select(
            "id, name, status, auto_delete_at, retention_days_remaining, org_name, total_employees"
        ).eq("org_id", _user["org_id"]).in_("status", ["draft", "active"]).order("auto_delete_at").execute()
        return result.data or []
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/gdpr/organizations — list orgs for dropdowns
# ============================================================
@router.get("/organizations")
async def list_organizations(request: Request, _user: dict = Depends(require_admin)):
    try:
        db = get_supabase_admin()
        result = db.table("organizations").select("*").eq("id", _user["org_id"]).order("name").execute()
        return result.data or []
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)
