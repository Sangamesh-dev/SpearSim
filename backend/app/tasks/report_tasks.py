"""
Celery background tasks for generating campaign PDF reports and uploading to Supabase Storage.
"""
import asyncio
from datetime import datetime, timezone
from app.celery_app import celery_app
from app.database import get_supabase_admin
from app.services.report_service import build_campaign_report_data
from app.services.pdf_service import generate_campaign_report_pdf


async def _async_generate_report_pdf(campaign_id: str) -> str:
    db = get_supabase_admin()

    # Build full report data structure
    report_data = await build_campaign_report_data(campaign_id)

    # Generate PDF bytes using ReportLab
    pdf_bytes = generate_campaign_report_pdf(report_data)

    # Ensure reports bucket exists
    try:
        db.storage.get_bucket("reports")
    except Exception:
        try:
            db.storage.create_bucket("reports", {"public": True})
        except Exception:
            pass

    # Upload to Supabase Storage
    file_name = f"report_{campaign_id}_{int(datetime.now(timezone.utc).timestamp())}.pdf"
    db.storage.from_("reports").upload(
        file_name,
        pdf_bytes,
        {"contentType": "application/pdf"}
    )
    public_url = db.storage.from_("reports").get_public_url(file_name)
    return public_url


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_report_pdf(self, campaign_id: str):
    try:
        public_url = asyncio.run(_async_generate_report_pdf(campaign_id))
        return public_url
    except Exception as exc:
        print(f"[CELERY TASK ERROR] generate_report_pdf failed for {campaign_id}: {exc}")
        raise self.retry(exc=exc)
