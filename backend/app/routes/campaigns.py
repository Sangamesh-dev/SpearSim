"""
Campaign management routes.
"""
import csv
import io
import uuid
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from app.models import (
    CampaignCreate, CampaignResponse, CampaignConsentUpdate,
    EmployeeUploadResult, SuccessResponse, ErrorResponse,
)
from app.database import get_supabase_admin
from app.services.audit_service import log_action, AuditAction
from app.services.llm_service import batch_generate_emails, generate_single_email
from app.services.email_service import send_batch_emails
from app.services.pdf_service import generate_authorization_pdf
from app.config import get_settings
from app.utils import get_client_ip, generate_alias
from app.rbac import require_analyst, require_viewer

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])
settings = get_settings()


def _validate_email_domain(email: str, domain: str) -> bool:
    """Check that email belongs to the organization domain."""
    email_domain = email.split("@")[-1].lower().strip()
    return email_domain == domain.lower().strip()


# ============================================================
# POST /api/campaigns/create
# ============================================================
@router.post("/create", response_model=CampaignResponse)
async def create_campaign(payload: CampaignCreate, request: Request, _user: dict = Depends(require_analyst)):
    try:
        db = get_supabase_admin()

        # Verify org exists
        org_result = db.table("organizations").select("*").eq("id", payload.org_id).maybe_single().execute()
        if not org_result or not org_result.data:
            raise HTTPException(status_code=404, detail="Organization not found")

        if payload.org_id != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Cannot create campaign for another organisation")

        auto_delete_at = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()

        result = db.table("campaigns").insert({
            "org_id": payload.org_id,
            "name": payload.name,
            "scenario_type": payload.scenario_type.value,
            "difficulty": payload.difficulty.value,
            "status": "draft",
            "consent_signed": False,
            "created_by": _user["email"],
            "auto_delete_at": auto_delete_at,
            "notes": payload.notes,
        }).execute()

        campaign = result.data[0]

        await log_action(
            actor_email=_user["email"],
            action=AuditAction.CAMPAIGN_CREATE,
            target_table="campaigns",
            target_id=campaign["id"],
            ip_address=get_client_ip(request),
            metadata={"name": payload.name, "scenario": payload.scenario_type.value},
            org_id=_user["org_id"],
        )

        return CampaignResponse(
            **campaign,
            org_name=org_result.data["name"],
            org_domain=org_result.data["domain"],
        )

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/campaigns — list all campaigns
# ============================================================
@router.get("/", response_model=list[CampaignResponse])
async def list_campaigns(request: Request, _user: dict = Depends(require_viewer)):
    try:
        db = get_supabase_admin()
        query = db.table("campaign_summary").select("*").eq("org_id", _user["org_id"])
        result = query.order("created_at", desc=True).execute()
        return [CampaignResponse(**c) for c in (result.data or [])]
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/campaigns/{id}
# ============================================================
@router.get("/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(campaign_id: str, request: Request, _user: dict = Depends(require_viewer)):
    try:
        db = get_supabase_admin()
        result = db.table("campaign_summary").select("*").eq("id", campaign_id).maybe_single().execute()
        if not result or not result.data:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
        if result.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")
            
        return CampaignResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# POST /api/campaigns/{id}/consent
# ============================================================
@router.post("/{campaign_id}/consent", response_model=SuccessResponse)
async def update_consent(
    campaign_id: str,
    payload: CampaignConsentUpdate,
    request: Request,
    _user: dict = Depends(require_analyst),
):
    try:
        db = get_supabase_admin()

        campaign = db.table("campaigns").select("*").eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        if campaign.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        if campaign.data["status"] != "draft":
            raise HTTPException(status_code=400, detail="Cannot update consent on a non-draft campaign")

        db.table("campaigns").update({
            "consent_signed": payload.consent_signed,
            "lawful_basis": payload.lawful_basis.value,
        }).eq("id", campaign_id).execute()

        await log_action(
            actor_email=campaign.data["created_by"],
            action=AuditAction.CAMPAIGN_CONSENT,
            target_table="campaigns",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            metadata={"lawful_basis": payload.lawful_basis.value},
            org_id=_user["org_id"],
        )

        return SuccessResponse(message="Consent recorded successfully")

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# POST /api/campaigns/{id}/launch
# ============================================================
@router.post("/{campaign_id}/launch", response_model=SuccessResponse)
async def launch_campaign(campaign_id: str, request: Request, _user: dict = Depends(require_analyst)):
    try:
        db = get_supabase_admin()

        # Fetch campaign + org
        campaign = db.table("campaigns").select("*, organizations(name, domain)").eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        c = campaign.data

        if c["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        # GDPR gate: consent must be signed
        if not c["consent_signed"]:
            raise HTTPException(
                status_code=403,
                detail="Campaign cannot be launched without signed consent. Complete the GDPR consent step first."
            )

        if c["status"] != "draft":
            raise HTTPException(status_code=400, detail=f"Campaign is already {c['status']}")

        # Fetch employees
        employees = db.table("employees").select("*").eq("campaign_id", campaign_id).execute()
        if not employees.data or len(employees.data) == 0:
            raise HTTPException(status_code=400, detail="No employees loaded. Upload a CSV first.")

        org_name = c["organizations"]["name"] if c.get("organizations") else "Your Organization"

        # Try background dispatch via Celery
        try:
            db.table("campaigns").update({
                "status": "active",
                "launched_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", campaign_id).execute()

            from app.tasks.email_tasks import send_campaign_emails
            task = send_campaign_emails.delay(
                campaign_id=campaign_id,
                org_name=org_name,
                scenario_type=c["scenario_type"],
                difficulty=c["difficulty"],
                base_url=settings.app_base_url,
            )
            return SuccessResponse(
                success=True,
                status="queued",
                message="Campaign emails are being sent in the background",
                task_id=task.id,
            )
        except Exception as celery_err:
            print(f"[CELERY QUEUE FAILED] {celery_err}. Falling back to synchronous email dispatch.")

            # Synchronous fallback
            email_jobs = await batch_generate_emails(
                employees=employees.data,
                company_name=org_name,
                scenario_type=c["scenario_type"],
                difficulty=c["difficulty"],
                base_url=settings.app_base_url,
            )

            send_result = await send_batch_emails(email_jobs, campaign_id)

            db.table("campaigns").update({
                "status": "active",
                "launched_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", campaign_id).execute()

            await log_action(
                actor_email=c["created_by"],
                action=AuditAction.CAMPAIGN_LAUNCH,
                target_table="campaigns",
                target_id=campaign_id,
                ip_address=get_client_ip(request),
                metadata={
                    "employees_targeted": len(employees.data),
                    "emails_sent": send_result["sent"],
                    "emails_failed": send_result["failed"],
                    "background_job": False,
                },
                org_id=_user["org_id"],
            )

            return SuccessResponse(
                success=True,
                status="completed",
                message=f"Campaign launched. {send_result['sent']} emails sent, {send_result['failed']} failed."
            )

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/campaigns/{id}/task-status/{task_id}
# ============================================================
@router.get("/{campaign_id}/task-status/{task_id}")
async def get_task_status(campaign_id: str, task_id: str, _user: dict = Depends(require_viewer)):
    try:
        from app.celery_app import celery_app
        task_res = celery_app.AsyncResult(task_id)
        
        db = get_supabase_admin()
        campaign = db.table("campaigns").select("org_id").eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data or campaign.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        info = task_res.info
        if isinstance(info, Exception):
            info = str(info)
            
        return {
            "task_id": task_id,
            "state": task_res.state,
            "result": info,
        }
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)



# ============================================================
# POST /api/campaigns/{id}/complete
# ============================================================
@router.post("/{campaign_id}/complete", response_model=SuccessResponse)
async def complete_campaign(campaign_id: str, request: Request, _user: dict = Depends(require_analyst)):
    try:
        db = get_supabase_admin()
        campaign = db.table("campaigns").select("*").eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        if campaign.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        db.table("campaigns").update({
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", campaign_id).execute()

        await log_action(
            actor_email=campaign.data["created_by"],
            action=AuditAction.CAMPAIGN_COMPLETE,
            target_table="campaigns",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            org_id=_user["org_id"],
        )

        return SuccessResponse(message="Campaign marked as completed")
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# POST /api/campaigns/{id}/resend
# ============================================================
@router.post("/{campaign_id}/resend", response_model=SuccessResponse)
async def resend_campaign_emails(campaign_id: str, request: Request, _user: dict = Depends(require_analyst)):
    try:
        db = get_supabase_admin()

        campaign = db.table("campaigns").select("*, organizations(name, domain)").eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        c = campaign.data

        if c["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        if c["status"] != "active":
            raise HTTPException(status_code=400, detail="Can only resend emails for active campaigns")

        employees = db.table("employees").select("*").eq("campaign_id", campaign_id).execute()
        if not employees or not employees.data:
            raise HTTPException(status_code=400, detail="No employees found")

        # Only resend to employees who have not clicked yet
        events = db.table("events").select("employee_id, event_type").eq("campaign_id", campaign_id).execute()
        clicked_ids = {e["employee_id"] for e in (events.data or []) if e["event_type"] in ("click", "cred_entered")}
        pending = [e for e in employees.data if e["id"] not in clicked_ids]

        if not pending:
            raise HTTPException(status_code=400, detail="All employees have already interacted with the simulation")

        org_name = c["organizations"]["name"] if c.get("organizations") else "Your Organization"

        # Try Celery first, fall back to synchronous dispatch
        try:
            from app.tasks.email_tasks import send_campaign_emails
            task = send_campaign_emails.delay(
                campaign_id=campaign_id,
                org_name=org_name,
                scenario_type=c["scenario_type"],
                difficulty=c["difficulty"],
                base_url=settings.app_base_url,
            )
            return SuccessResponse(
                success=True,
                status="queued",
                message=f"Re-send queued for {len(pending)} employees in the background.",
                task_id=task.id,
            )
        except Exception as celery_err:
            print(f"[CELERY QUEUE FAILED on resend] {celery_err}. Falling back to synchronous dispatch.")

        email_jobs = await batch_generate_emails(
            employees=pending,
            company_name=org_name,
            scenario_type=c["scenario_type"],
            difficulty=c["difficulty"],
            base_url=settings.app_base_url,
        )

        send_result = await send_batch_emails(email_jobs, campaign_id)

        await log_action(
            actor_email=c["created_by"],
            action=AuditAction.CAMPAIGN_LAUNCH,
            target_table="campaigns",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            metadata={
                "resend": True,
                "pending_employees": len(pending),
                "emails_sent": send_result["sent"],
                "emails_failed": send_result["failed"],
                "background_job": False,
            },
            org_id=_user["org_id"],
        )

        return SuccessResponse(
            message=f"Re-sent to {send_result['sent']} employees who had not yet interacted. {send_result['failed']} failed."
        )

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# DELETE /api/campaigns/{id}
# ============================================================
@router.delete("/{campaign_id}", response_model=SuccessResponse)
async def delete_campaign(campaign_id: str, request: Request, _user: dict = Depends(require_analyst)):
    try:
        db = get_supabase_admin()

        campaign = db.table("campaigns").select("*").eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        if campaign.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        # Delete in order: events → name_map → employees → campaign
        employees = db.table("employees").select("id, alias").eq("campaign_id", campaign_id).execute()
        db.table("events").delete().eq("campaign_id", campaign_id).execute()
        if employees and employees.data:
            aliases = [e["alias"] for e in employees.data]
            db.table("name_map").delete().in_("alias", aliases).execute()
        db.table("employees").delete().eq("campaign_id", campaign_id).execute()
        db.table("campaigns").delete().eq("id", campaign_id).execute()

        await log_action(
            actor_email=campaign.data["created_by"],
            action=AuditAction.CAMPAIGN_DELETE,
            target_table="campaigns",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            metadata={"name": campaign.data["name"]},
            org_id=_user["org_id"],
        )

        return SuccessResponse(message="Campaign deleted successfully")

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/campaigns/{id}/preview-email
# ============================================================
@router.get("/{campaign_id}/preview-email")
async def preview_campaign_email(campaign_id: str, request: Request, _user: dict = Depends(require_analyst)):
    """
    Generate a sample phishing email for admin preview before launch.
    Does NOT send the email and does NOT write to the database.
    """
    try:
        db = get_supabase_admin()

        campaign = db.table("campaigns").select(
            "*, organizations(name, domain)"
        ).eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        c = campaign.data

        if c["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        # Fetch the first employee for this campaign
        employees = db.table("employees").select("*").eq(
            "campaign_id", campaign_id
        ).limit(1).execute()

        if not employees or not employees.data:
            raise HTTPException(
                status_code=400,
                detail="Upload employees CSV before previewing"
            )

        emp = employees.data[0]
        org_name = c["organizations"]["name"] if c.get("organizations") else "Your Organization"

        preview = await generate_single_email(
            emp=emp,
            company_name=org_name,
            scenario_type=c["scenario_type"],
            difficulty=c["difficulty"],
            base_url=settings.app_base_url,
        )

        return preview

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/campaigns/{id}/report
# ============================================================
@router.get("/{campaign_id}/report")
async def get_campaign_report(campaign_id: str, request: Request, _user: dict = Depends(require_viewer)):
    try:
        from app.services.report_service import build_campaign_report_data
        report = await build_campaign_report_data(campaign_id)
        if report["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        await log_action(
            actor_email=_user["email"],
            action=AuditAction.REPORT_VIEW,
            target_table="campaigns",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            org_id=_user["org_id"],
        )

        return report

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/campaigns/{id}/report/pdf
# ============================================================
@router.get("/{campaign_id}/report/pdf")
async def download_report_pdf(campaign_id: str, request: Request, _user: dict = Depends(require_viewer)):
    try:
        from app.services.pdf_service import generate_campaign_report_pdf

        # Reuse report logic
        report_response = await get_campaign_report(campaign_id, request, _user)
        pdf_bytes = generate_campaign_report_pdf(report_response)

        await log_action(
            actor_email=_user["email"],
            action=AuditAction.REPORT_EXPORT_PDF,
            target_table="campaigns",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            org_id=_user["org_id"],
        )

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=phishsim-report-{campaign_id[:8]}.pdf"},
        )
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/campaigns/{id}/report/csv
# ============================================================
@router.get("/{campaign_id}/report/csv")
async def download_report_csv(campaign_id: str, request: Request, _user: dict = Depends(require_viewer)):
    try:
        report = await get_campaign_report(campaign_id, request, _user)
        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=["alias", "role_generic", "opened", "clicked", "cred_entered", "risk_level"],
        )
        writer.writeheader()
        for emp in report["employees"]:
            writer.writerow({
                "alias": emp["alias"],
                "role_generic": emp["role_generic"],
                "opened": emp["opened"],
                "clicked": emp["clicked"],
                "cred_entered": emp["cred_entered"],
                "risk_level": emp["risk_level"],
            })

        await log_action(
            actor_email=_user["email"],
            action=AuditAction.REPORT_EXPORT_CSV,
            target_table="campaigns",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            org_id=_user["org_id"],
        )

        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=phishsim-report-{campaign_id[:8]}.csv"},
        )
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)
