"""
Service for generating campaign report analytics and data structures.
"""
import asyncio
from datetime import datetime, timezone
from fastapi import HTTPException
from app.database import get_supabase_admin
from app.services.llm_service import generate_remediation_advice


async def build_campaign_report_data(campaign_id: str) -> dict:
    db = get_supabase_admin()

    campaign = db.table("campaign_summary").select("*").eq("id", campaign_id).maybe_single().execute()
    if not campaign or not campaign.data:
        raise HTTPException(status_code=404, detail="Campaign not found")

    c = campaign.data
    employees = db.table("employees").select("*").eq("campaign_id", campaign_id).execute()
    events = db.table("events").select("*").eq("campaign_id", campaign_id).execute()

    emp_list = employees.data or []
    evt_list = events.data or []

    # Build per-employee event map
    emp_events: dict[str, set] = {}
    for evt in evt_list:
        eid = evt["employee_id"]
        if eid not in emp_events:
            emp_events[eid] = set()
        emp_events[eid].add(evt["event_type"])

    total = len(emp_list)
    total_opened = sum(1 for e in emp_list if "open" in emp_events.get(e["id"], set()))
    total_clicked = sum(1 for e in emp_list if "click" in emp_events.get(e["id"], set()))
    total_creds = sum(1 for e in emp_list if "cred_entered" in emp_events.get(e["id"], set()))

    open_rate = (total_opened / total * 100) if total > 0 else 0
    click_rate = (total_clicked / total * 100) if total > 0 else 0
    cred_rate = (total_creds / total * 100) if total > 0 else 0
    risk_score = ((total_clicked + total_creds) / total * 100) if total > 0 else 0

    async def build_emp_row(emp: dict) -> dict:
        evts = emp_events.get(emp["id"], set())
        opened = "open" in evts
        clicked = "click" in evts
        cred = "cred_entered" in evts

        if cred:
            risk = "High"
        elif clicked:
            risk = "Medium"
        else:
            risk = "Low"

        remediation = None
        if clicked or cred:
            try:
                remediation = await generate_remediation_advice(
                    scenario_type=c["scenario_type"],
                    difficulty=c["difficulty"],
                    alias=emp["alias"],
                    role_generic=emp["role_generic"],
                )
            except Exception:
                remediation = "Complete phishing awareness training module."

        return {
            "alias": emp["alias"],
            "role_generic": emp["role_generic"],
            "opened": opened,
            "clicked": clicked,
            "cred_entered": cred,
            "risk_level": risk,
            "remediation": remediation,
        }

    emp_rows = await asyncio.gather(*[build_emp_row(e) for e in emp_list])

    # ── Quiz results ──────────────────────────────────────
    quiz_results = db.table("quiz_results").select(
        "employee_id, score"
    ).eq("campaign_id", campaign_id).execute()

    quiz_map: dict[str, int] = {}
    for qr in (quiz_results.data or []):
        quiz_map[qr["employee_id"]] = qr["score"]

    # Merge quiz_score into each emp_row
    emp_rows_with_quiz = []
    for i, row in enumerate(emp_rows):
        emp_id = emp_list[i]["id"]
        row_dict = dict(row)
        row_dict["quiz_score"] = quiz_map.get(emp_id)
        emp_rows_with_quiz.append(row_dict)

    quiz_completions = len(quiz_map)
    quiz_completion_rate = round((quiz_completions / total * 100), 1) if total > 0 else 0.0
    quiz_avg_score = round(
        sum(quiz_map.values()) / quiz_completions, 2
    ) if quiz_completions > 0 else 0.0

    report = {
        "campaign_id": campaign_id,
        "campaign_name": c["name"],
        "scenario_type": c["scenario_type"],
        "difficulty": c["difficulty"],
        "org_name": c["org_name"],
        "total_targeted": total,
        "total_opened": total_opened,
        "total_clicked": total_clicked,
        "total_creds": total_creds,
        "open_rate": round(open_rate, 1),
        "click_rate": round(click_rate, 1),
        "cred_rate": round(cred_rate, 1),
        "risk_score": round(risk_score, 1),
        "industry_benchmark": 32.0,
        "quiz_completion_rate": quiz_completion_rate,
        "quiz_avg_score": quiz_avg_score,
        "employees": emp_rows_with_quiz,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "org_id": c["org_id"],
    }

    return report
