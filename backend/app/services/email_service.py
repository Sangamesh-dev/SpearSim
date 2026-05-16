"""
Email delivery service via SendGrid.
Adds X-PhishSim-Authorized header to every simulation email.
"""
import asyncio
import httpx
from app.config import get_settings

settings = get_settings()

SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send"


async def send_phishing_simulation_email(
    to_email: str,
    subject: str,
    body_html: str,
    campaign_id: str,
    employee_uuid: str,
) -> bool:
    """
    Send a phishing simulation email via SendGrid.
    Includes X-PhishSim-Authorized header for identification.
    Retries up to 3 times with exponential backoff on network errors or 429/5xx status codes.
    """
    headers = {
        "Authorization": f"Bearer {settings.sendgrid_api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "personalizations": [
            {
                "to": [{"email": to_email}],
                "subject": subject,
            }
        ],
        "from": {
            "email": settings.sendgrid_from_email,
            "name": settings.sendgrid_from_name,
        },
        "content": [
            {
                "type": "text/html",
                "value": body_html,
            }
        ],
        "headers": {
            # Simulation identification header — required for compliance
            "X-PhishSim-Authorized": "true",
            "X-PhishSim-Campaign": campaign_id,
            "X-PhishSim-Employee": employee_uuid,
        },
        "tracking_settings": {
            # Disable SendGrid's own click tracking — we handle it ourselves
            "click_tracking": {"enable": False},
            "open_tracking": {"enable": False},
        },
    }

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(SENDGRID_API_URL, headers=headers, json=payload)
                if response.status_code in (200, 202):
                    return True
                if response.status_code >= 500 or response.status_code == 429:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                        continue
                print(f"[SendGrid] Failed to send to {to_email}: {response.status_code} {response.text}")
                return False
        except httpx.HTTPError as exc:
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            print(f"[SendGrid] Exception sending to {to_email}: {exc}")
            return False
    return False


async def send_batch_emails(email_jobs: list[dict], campaign_id: str) -> dict:
    """
    Send emails to all employees in a campaign.
    email_jobs: list of {email, subject, body_html, employee_uuid}
    Returns: {sent: int, failed: int}
    """
    import asyncio

    semaphore = asyncio.Semaphore(10)  # Max 10 concurrent SendGrid requests

    async def send_one(job: dict) -> bool:
        async with semaphore:
            return await send_phishing_simulation_email(
                to_email=job["email"],
                subject=job["subject"],
                body_html=job["body_html"],
                campaign_id=campaign_id,
                employee_uuid=job["employee_uuid"],
            )

    results = await asyncio.gather(*[send_one(job) for job in email_jobs])
    sent = sum(1 for r in results if r)
    failed = sum(1 for r in results if not r)
    return {"sent": sent, "failed": failed}
