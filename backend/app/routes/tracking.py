"""
Tracking routes — open pixel, click redirect, credential entry.
These are public endpoints (no auth required).
"""
import base64
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response, RedirectResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import Any

from app.database import get_supabase_admin
from app.services.audit_service import log_action, AuditAction
from app.config import get_settings
from app.utils import get_client_ip
from app.limiter import limiter

router = APIRouter(tags=["tracking"])
settings = get_settings()

# 1x1 transparent GIF
TRANSPARENT_GIF = base64.b64decode(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)


async def _log_event(
    employee_uuid: str,
    event_type: str,
    ip_address: str,
    user_agent: str,
) -> bool:
    """Log a tracking event. Returns True if employee found."""
    try:
        db = get_supabase_admin()

        # Look up employee by tracking UUID
        emp = db.table("employees").select("id, campaign_id").eq("uuid", employee_uuid).maybe_single().execute()
        if not emp or not emp.data:
            return False

        # Check for duplicate event (idempotent — don't double-count)
        existing = db.table("events").select("id").eq(
            "employee_id", emp.data["id"]
        ).eq("event_type", event_type).execute()

        if not existing or not existing.data:
            db.table("events").insert({
                "employee_id": emp.data["id"],
                "campaign_id": emp.data["campaign_id"],
                "event_type": event_type,
                "ip_address": ip_address,
                "user_agent": user_agent,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }).execute()

        return True
    except Exception as e:
        print(f"[TRACKING] Failed to log {event_type} for {employee_uuid}: {e}")
        return False


# ============================================================
# GET /track/open/{uuid} — tracking pixel
# ============================================================
@router.get("/track/open/{employee_uuid}")
@limiter.limit("60/minute")
async def track_open(employee_uuid: str, request: Request):
    """
    Serve a 1x1 transparent GIF and log an 'open' event.
    No real data is captured — only the event flag.
    """
    await _log_event(
        employee_uuid=employee_uuid,
        event_type="open",
        ip_address=get_client_ip(request),
        user_agent=request.headers.get("User-Agent", ""),
    )
    return Response(
        content=TRANSPARENT_GIF,
        media_type="image/gif",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )


# ============================================================
# GET /track/click/{uuid} — click redirect
# ============================================================
@router.get("/track/click/{employee_uuid}")
@limiter.limit("10/minute")
async def track_click(employee_uuid: str, request: Request):
    """
    Log a 'click' event and redirect to the fake phishing landing page.
    """
    await _log_event(
        employee_uuid=employee_uuid,
        event_type="click",
        ip_address=get_client_ip(request),
        user_agent=request.headers.get("User-Agent", ""),
    )
    return RedirectResponse(
        url=f"{settings.frontend_url}/phish/{employee_uuid}",
        status_code=302,
    )


# ============================================================
# POST /track/cred/{uuid} — credential submission
# ============================================================
@router.post("/track/cred/{employee_uuid}")
@limiter.limit("5/minute")
async def track_cred(employee_uuid: str, request: Request):
    """
    Log a 'cred_entered' event.
    IMPORTANT: No credentials are stored. Only the event flag is recorded.
    The response instructs the frontend to show the awareness screen.
    """
    found = await _log_event(
        employee_uuid=employee_uuid,
        event_type="cred_entered",
        ip_address=get_client_ip(request),
        user_agent=request.headers.get("User-Agent", ""),
    )

    # Return awareness redirect instruction — credentials are NOT stored
    return JSONResponse({
        "success": True,
        "action": "show_awareness",
        "message": "Simulation event recorded. No credentials were captured.",
    })


# ============================================================
# POST /api/track/quiz/{uuid} — awareness quiz submission
# ============================================================
class QuizSubmission(BaseModel):
    score: int
    answers: dict


@router.post("/api/track/quiz/{employee_uuid}")
async def submit_quiz(employee_uuid: str, payload: QuizSubmission, request: Request):
    """
    Record quiz results for an employee after the phish reveal.
    Score is 0–3 (number of correct answers).
    No PII is stored — only the alias-linked UUID and score.
    """
    try:
        db = get_supabase_admin()

        emp = db.table("employees").select("id, campaign_id").eq(
            "uuid", employee_uuid
        ).maybe_single().execute()

        if not emp or not emp.data:
            raise HTTPException(status_code=404, detail="Invalid simulation link")

        # Idempotent — only record first submission
        existing = db.table("quiz_results").select("id").eq(
            "employee_id", emp.data["id"]
        ).execute()

        if not existing or not existing.data:
            db.table("quiz_results").insert({
                "campaign_id": emp.data["campaign_id"],
                "employee_id": emp.data["id"],
                "score": max(0, min(3, payload.score)),
                "answers": payload.answers,
            }).execute()

        return JSONResponse({"message": "Quiz recorded"})

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /phish/{uuid} — fake landing page (served by frontend)
# This route provides the data needed for the phish page
# ============================================================
@router.get("/api/phish/{employee_uuid}")
async def get_phish_context(employee_uuid: str, request: Request):
    """
    Return context for the phishing landing page.
    Used by the React frontend to render the fake login form.
    """
    try:
        db = get_supabase_admin()

        emp = db.table("employees").select(
            "id, alias, role_generic, campaign_id"
        ).eq("uuid", employee_uuid).maybe_single().execute()

        if not emp or not emp.data:
            raise HTTPException(status_code=404, detail="Invalid simulation link")

        campaign = db.table("campaigns").select(
            "scenario_type, difficulty, organizations(name)"
        ).eq("id", emp.data["campaign_id"]).maybe_single().execute()

        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        # Check if cred already entered (to skip straight to awareness)
        cred_event = db.table("events").select("id").eq(
            "employee_id", emp.data["id"]
        ).eq("event_type", "cred_entered").execute()

        scenario = campaign.data["scenario_type"]
        org_name = campaign.data.get("organizations", {}).get("name", "Your Organization")

        # Red flags based on scenario
        red_flags = _get_red_flags(scenario)

        return {
            "employee_uuid": employee_uuid,
            "scenario_type": scenario,
            "org_name": org_name,
            "red_flags": red_flags,
            "already_submitted": bool(cred_event.data),
        }

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


def _get_red_flags(scenario_type: str) -> list[str]:
    """Return 3 red flags relevant to the scenario."""
    flags = {
        "IT Support": [
            "The sender email domain didn't match your company's official IT domain",
            "Legitimate IT teams never ask for credentials via email links",
            "The urgency ('immediate action required') is a classic pressure tactic",
        ],
        "HR": [
            "HR departments send official communications through internal systems, not external links",
            "The email asked you to verify personal details via an external website",
            "Hover over links before clicking — the URL didn't match your company domain",
        ],
        "Finance": [
            "Finance teams never request payment approvals via email links",
            "The sender address used a lookalike domain (e.g., company-finance.com vs company.com)",
            "Urgent payment requests are a hallmark of Business Email Compromise (BEC) attacks",
        ],
        "CEO Fraud": [
            "Executives rarely send direct emails requesting urgent wire transfers or credential resets",
            "The email bypassed normal approval channels — a major red flag",
            "Always verify unusual CEO requests via a separate communication channel (phone call)",
        ],
        "Vendor": [
            "Vendor invoice emails should be verified against your procurement system",
            "The link pointed to an external domain, not your vendor's official portal",
            "Unexpected billing notifications with urgent payment deadlines are a common phishing vector",
        ],
    }
    return flags.get(scenario_type, [
        "Always verify the sender's email domain carefully",
        "Hover over links before clicking to check the destination URL",
        "When in doubt, contact the sender through a known, trusted channel",
    ])
