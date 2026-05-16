"""
Audit logging service — Article 30 compliance.
All actions are logged with actor, timestamp, IP, and metadata.
Audit logs are append-only (no delete endpoint).
"""
from datetime import datetime, timezone
from typing import Optional
from app.database import get_supabase_admin


async def log_action(
    actor_email: str,
    action: str,
    target_table: Optional[str] = None,
    target_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    metadata: Optional[dict] = None,
    org_id: Optional[str] = None,
) -> None:
    """
    Append an entry to the audit_logs table.
    This is fire-and-forget — errors are logged but not raised.
    """
    try:
        db = get_supabase_admin()
        db.table("audit_logs").insert({
            "actor_email": actor_email,
            "action": action,
            "target_table": target_table,
            "target_id": str(target_id) if target_id else None,
            "ip_address": ip_address,
            "metadata": metadata or {},
            "org_id": org_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        # Audit failures must not break the main flow
        print(f"[AUDIT] Failed to log action '{action}': {e}")


# ============================================================
# Action constants — use these for consistency
# ============================================================
class AuditAction:
    # Auth
    LOGIN = "USER_LOGIN"
    LOGOUT = "USER_LOGOUT"
    TERMS_ACCEPTED = "USER_TERMS_ACCEPTED"

    # Organizations
    ORG_CREATE = "ORG_CREATE"

    # Campaigns
    CAMPAIGN_CREATE = "CAMPAIGN_CREATE"
    CAMPAIGN_LAUNCH = "CAMPAIGN_LAUNCH"
    CAMPAIGN_COMPLETE = "CAMPAIGN_COMPLETE"
    CAMPAIGN_DELETE = "CAMPAIGN_DELETE"
    CAMPAIGN_CONSENT = "CAMPAIGN_CONSENT_SIGNED"

    # Employees
    CSV_UPLOAD = "CSV_UPLOAD"
    CSV_REJECT = "CSV_DOMAIN_REJECT"

    # Tracking
    EMAIL_OPEN = "EMAIL_OPEN_TRACKED"
    EMAIL_CLICK = "EMAIL_CLICK_TRACKED"
    CRED_ENTERED = "CRED_ENTERED_TRACKED"

    # GDPR
    ERASURE_REQUEST = "GDPR_ERASURE_REQUEST"
    ERASURE_COMPLETE = "GDPR_ERASURE_COMPLETE"
    RETENTION_DELETE = "RETENTION_AUTO_DELETE"
    CONSENT_PDF_DOWNLOAD = "CONSENT_PDF_DOWNLOAD"

    # Reports
    REPORT_VIEW = "REPORT_VIEW"
    REPORT_EXPORT_PDF = "REPORT_EXPORT_PDF"
    REPORT_EXPORT_CSV = "REPORT_EXPORT_CSV"
    ERASURE_RECEIPT_DOWNLOAD = "ERASURE_RECEIPT_DOWNLOAD"
