"""
Employee management routes — CSV upload with pseudonymisation.
"""
import csv
import io
import uuid
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, Depends
from app.models import EmployeeUploadResult
from app.database import get_supabase_admin
from app.services.audit_service import log_action, AuditAction
from app.config import get_settings
from app.utils import get_client_ip, generate_alias
from app.rbac import require_analyst, require_viewer

router = APIRouter(prefix="/api/employees", tags=["employees"])
settings = get_settings()

MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_ROWS = 5_000


# ============================================================
# POST /api/employees/upload-csv
# ============================================================
@router.post("/upload-csv", response_model=EmployeeUploadResult)
async def upload_employees_csv(
    request: Request,
    campaign_id: str = Form(...),
    file: UploadFile = File(...),
    _user: dict = Depends(require_analyst),
):
    """
    Upload a CSV of employees for a campaign.

    PSEUDONYMISATION:
    - Real names (if present) are stored encrypted in name_map
    - Only alias + generic role stored in employees table
    - Domain whitelist enforced per row

    CSV format: email, role[, name (optional)]
    """
    try:
        content = await file.read(MAX_CSV_BYTES + 1)
        if len(content) > MAX_CSV_BYTES:
            raise HTTPException(status_code=413, detail="CSV file exceeds 5 MB limit")

        db = get_supabase_admin()

        # Fetch campaign + org domain
        campaign = db.table("campaigns").select(
            "*, organizations(domain)"
        ).eq("id", campaign_id).maybe_single().execute()

        if not campaign or not campaign.data:
            raise HTTPException(status_code=404, detail="Campaign not found")

        if campaign.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        if campaign.data["status"] != "draft":
            raise HTTPException(status_code=400, detail="Can only upload employees to draft campaigns")

        org_domain = campaign.data["organizations"]["domain"].lower().strip()

        # Parse CSV
        try:
            text = content.decode("utf-8-sig")  # Handle BOM
        except UnicodeDecodeError:
            text = content.decode("latin-1")

        reader = csv.DictReader(io.StringIO(text))

        # Normalize headers
        if reader.fieldnames is None:
            raise HTTPException(status_code=400, detail="CSV file is empty or has no headers")

        normalized_fields = {f.strip().lower(): f for f in reader.fieldnames}
        if "email" not in normalized_fields:
            raise HTTPException(status_code=400, detail="CSV must have an 'email' column")
        if "role" not in normalized_fields:
            raise HTTPException(status_code=400, detail="CSV must have a 'role' column")

        # Valid scenario override values
        valid_scenarios = {"IT Support", "HR", "Finance", "CEO Fraud", "Vendor"}

        loaded = []
        rejected = []
        preview = []
        name_map_entries = []

        # Fetch existing aliases for this campaign and seed deduplication set
        existing_result = db.table("employees").select("alias").eq("campaign_id", campaign_id).execute()
        used_aliases: set[str] = {e["alias"] for e in (existing_result.data or [])}

        for row in reader:
            email = row.get(normalized_fields["email"], "").strip().lower()
            role = row.get(normalized_fields["role"], "").strip()
            real_name = row.get(normalized_fields.get("name", ""), "").strip() if "name" in normalized_fields else None

            # Optional per-employee scenario override
            raw_scenario = row.get(normalized_fields.get("scenario", ""), "").strip() if "scenario" in normalized_fields else None
            scenario_override = raw_scenario if raw_scenario in valid_scenarios else None

            if not email or not role:
                continue

            # Domain whitelist enforcement
            email_domain = email.split("@")[-1].lower().strip() if "@" in email else ""
            if email_domain != org_domain:
                rejected.append(email)
                await log_action(
                    actor_email=campaign.data["created_by"],
                    action=AuditAction.CSV_REJECT,
                    target_table="employees",
                    ip_address=get_client_ip(request),
                    metadata={
                        "email_domain": email_domain,
                        "expected_domain": org_domain,
                        "campaign_id": campaign_id,
                    },
                    org_id=_user["org_id"],
                )
                continue

            # Generate unique alias
            alias = generate_alias()
            while alias in used_aliases:
                alias = generate_alias()
            used_aliases.add(alias)

            # Truncate role to generic (max 50 chars, no specific titles)
            role_generic = role[:50]

            tracking_uuid = str(uuid.uuid4())

            loaded.append({
                "campaign_id": campaign_id,
                "alias": alias,
                "email": email,
                "role_generic": role_generic,
                "uuid": tracking_uuid,
                "scenario_override": scenario_override,
            })

            if real_name:
                name_map_entries.append({
                    "alias": alias,
                    "real_name": real_name,
                    "campaign_id": campaign_id,
                })

            preview.append({
                "alias": alias,
                "role_generic": role_generic,
                # email intentionally omitted from preview
            })

            if len(loaded) >= MAX_ROWS:
                break

        if not loaded:
            raise HTTPException(
                status_code=400,
                detail=f"No valid employees found. All {len(rejected)} rows were rejected (domain mismatch or missing data)."
            )

        if len(loaded) >= MAX_ROWS:
            await log_action(
                actor_email=campaign.data["created_by"],
                action=AuditAction.CSV_UPLOAD,
                target_table="employees",
                target_id=campaign_id,
                ip_address=get_client_ip(request),
                metadata={
                    "loaded": len(loaded),
                    "rejected": len(rejected),
                    "truncated": True,
                    "max_rows": MAX_ROWS,
                    "campaign_id": campaign_id,
                },
                org_id=_user["org_id"],
            )
            raise HTTPException(
                status_code=400,
                detail=f"CSV truncated: exceeded {MAX_ROWS} employee limit. Upload a smaller file."
            )

        # Batch insert employees (parameterised — no SQL injection risk)
        db.table("employees").insert(loaded).execute()

        # Store name_map entries (encrypted at rest via Supabase Vault)
        if name_map_entries:
            db.table("name_map").insert(name_map_entries).execute()

        await log_action(
            actor_email=campaign.data["created_by"],
            action=AuditAction.CSV_UPLOAD,
            target_table="employees",
            target_id=campaign_id,
            ip_address=get_client_ip(request),
            metadata={
                "loaded": len(loaded),
                "rejected": len(rejected),
                "campaign_id": campaign_id,
            },
            org_id=_user["org_id"],
        )

        return EmployeeUploadResult(
            loaded=len(loaded),
            rejected=len(rejected),
            rejected_emails=rejected,
            preview=preview,
        )

    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)


# ============================================================
# GET /api/employees/{campaign_id}
# ============================================================
@router.get("/{campaign_id}")
async def list_employees(campaign_id: str, request: Request, _user: dict = Depends(require_viewer)):
    """List employees for a campaign (alias + role only, no email in response)."""
    try:
        db = get_supabase_admin()
        
        # Verify campaign belongs to org
        campaign = db.table("campaigns").select("org_id").eq("id", campaign_id).maybe_single().execute()
        if not campaign or not campaign.data or campaign.data["org_id"] != _user["org_id"]:
            raise HTTPException(status_code=404, detail="Campaign not found")

        result = db.table("employees").select(
            "id, alias, role_generic, uuid, scenario_override, created_at"
        ).eq("campaign_id", campaign_id).execute()
        return result.data or []
    except HTTPException:
        raise
    except Exception as e:
        detail = str(e) if settings.environment == "development" else "An unexpected error occurred"
        raise HTTPException(status_code=500, detail=detail)
