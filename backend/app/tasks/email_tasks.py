"""
Celery background tasks for generating and sending campaign emails.
"""
import asyncio
from datetime import datetime, timezone
from app.celery_app import celery_app
from app.database import get_supabase_admin
from app.services.llm_service import batch_generate_emails
from app.services.email_service import send_batch_emails
from app.services.audit_service import log_action, AuditAction


async def _async_send_campaign_emails(campaign_id: str, org_name: str, scenario_type: str, difficulty: str, base_url: str) -> dict:
    db = get_supabase_admin()
    
    # Fetch campaign metadata
    campaign = db.table("campaigns").select("*").eq("id", campaign_id).maybe_single().execute()
    if not campaign or not campaign.data:
        raise ValueError(f"Campaign {campaign_id} not found")
        
    c = campaign.data
    actor_email = c["created_by"]
    org_id = c["org_id"]
    
    # Fetch all employees for campaign
    employees = db.table("employees").select("*").eq("campaign_id", campaign_id).execute()
    if not employees or not employees.data:
        raise ValueError(f"No employees found for campaign {campaign_id}")
        
    emp_list = employees.data
    
    # Generate email content via LLM
    email_jobs = await batch_generate_emails(
        employees=emp_list,
        company_name=org_name,
        scenario_type=scenario_type,
        difficulty=difficulty,
        base_url=base_url,
    )
    
    # Send emails via SendGrid
    send_result = await send_batch_emails(email_jobs, campaign_id)
    
    # Update campaign status
    db.table("campaigns").update({
        "status": "active",
        "launched_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", campaign_id).execute()
    
    # Log result to audit_logs
    await log_action(
        actor_email=actor_email,
        action=AuditAction.CAMPAIGN_LAUNCH,
        target_table="campaigns",
        target_id=campaign_id,
        metadata={
            "employees_targeted": len(emp_list),
            "emails_sent": send_result["sent"],
            "emails_failed": send_result["failed"],
            "background_job": True,
        },
        org_id=org_id,
    )
    return send_result


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_campaign_emails(self, campaign_id: str, org_name: str, scenario_type: str, difficulty: str, base_url: str):
    try:
        result = asyncio.run(
            _async_send_campaign_emails(
                campaign_id=campaign_id,
                org_name=org_name,
                scenario_type=scenario_type,
                difficulty=difficulty,
                base_url=base_url,
            )
        )
        return result
    except Exception as exc:
        print(f"[CELERY TASK ERROR] send_campaign_emails failed for {campaign_id}: {exc}")
        raise self.retry(exc=exc)
