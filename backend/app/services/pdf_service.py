"""
PDF generation service using ReportLab.
Generates: authorization PDFs, erasure receipts, campaign reports.
"""
import io
from datetime import datetime, timezone
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT


BRAND_BLUE = colors.HexColor("#1e40af")
BRAND_DARK = colors.HexColor("#1e293b")
BRAND_GRAY = colors.HexColor("#64748b")
BRAND_RED = colors.HexColor("#dc2626")
BRAND_GREEN = colors.HexColor("#16a34a")
BRAND_LIGHT = colors.HexColor("#f1f5f9")


def _base_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="PhishTitle",
        fontSize=22,
        textColor=BRAND_BLUE,
        spaceAfter=6,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="PhishSubtitle",
        fontSize=11,
        textColor=BRAND_GRAY,
        spaceAfter=20,
        fontName="Helvetica",
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="PhishHeading",
        fontSize=13,
        textColor=BRAND_DARK,
        spaceBefore=14,
        spaceAfter=6,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        name="PhishBody",
        fontSize=10,
        textColor=BRAND_DARK,
        spaceAfter=6,
        fontName="Helvetica",
        leading=15,
    ))
    styles.add(ParagraphStyle(
        name="PhishSmall",
        fontSize=8,
        textColor=BRAND_GRAY,
        fontName="Helvetica",
        leading=12,
    ))
    styles.add(ParagraphStyle(
        name="PhishLabel",
        fontSize=9,
        textColor=BRAND_GRAY,
        fontName="Helvetica-Bold",
        spaceAfter=2,
    ))
    styles.add(ParagraphStyle(
        name="PhishValue",
        fontSize=10,
        textColor=BRAND_DARK,
        fontName="Helvetica",
        spaceAfter=8,
    ))
    return styles


def generate_authorization_pdf(
    org_name: str,
    admin_email: str,
    campaign_name: str,
    campaign_scope: str,
    lawful_basis: str,
    campaign_id: str,
) -> bytes:
    """Generate a signed authorization PDF for campaign consent."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2.5 * cm,
        leftMargin=2.5 * cm,
        topMargin=2.5 * cm,
        bottomMargin=2.5 * cm,
    )
    styles = _base_styles()
    story = []

    # Header
    story.append(Paragraph("PhishSim", styles["PhishTitle"]))
    story.append(Paragraph("Phishing Simulation Authorization Document", styles["PhishSubtitle"]))
    story.append(HRFlowable(width="100%", thickness=2, color=BRAND_BLUE, spaceAfter=20))

    # Legal notice
    story.append(Paragraph("AUTHORIZED SECURITY AWARENESS TRAINING", styles["PhishHeading"]))
    story.append(Paragraph(
        "This document serves as the official authorization record for a phishing simulation "
        "campaign conducted under the PhishSim platform. This simulation is conducted solely "
        "for security awareness training purposes and complies with applicable data protection "
        "regulations including GDPR.",
        styles["PhishBody"]
    ))
    story.append(Spacer(1, 12))

    # Campaign details table
    story.append(Paragraph("Campaign Details", styles["PhishHeading"]))
    details = [
        ["Organization", org_name],
        ["Campaign Name", campaign_name],
        ["Campaign ID", campaign_id],
        ["Campaign Scope", campaign_scope],
        ["Authorized By", admin_email],
        ["Lawful Basis (GDPR)", lawful_basis],
        ["Authorization Date", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")],
        ["Data Retention", "90 days from campaign creation (Article 5(1)(e))"],
    ]
    table = Table(details, colWidths=[5 * cm, 11 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), BRAND_LIGHT),
        ("TEXTCOLOR", (0, 0), (0, -1), BRAND_GRAY),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(table)
    story.append(Spacer(1, 16))

    # GDPR compliance section
    story.append(Paragraph("GDPR Compliance Commitments", styles["PhishHeading"]))
    commitments = [
        "✓  Employee names are pseudonymised — real names are never stored in simulation records",
        "✓  LLM prompts contain only aliases and generic roles — no PII transmitted to AI services",
        "✓  All simulation data will be automatically deleted after 90 days (Article 5(1)(e))",
        "✓  Employees have the right to erasure of their simulation records (Article 17)",
        "✓  No real credentials are captured — the credential page is a safe simulation only",
        "✓  All actions are logged in a tamper-evident audit trail (Article 30)",
        "✓  Domain whitelist enforcement prevents simulation of non-organizational emails",
    ]
    for c in commitments:
        story.append(Paragraph(c, styles["PhishBody"]))
    story.append(Spacer(1, 16))

    # Admin declaration
    story.append(HRFlowable(width="100%", thickness=1, color=BRAND_GRAY, spaceAfter=12))
    story.append(Paragraph("Administrator Declaration", styles["PhishHeading"]))
    story.append(Paragraph(
        f"I, <b>{admin_email}</b>, confirm that I have the authority to conduct this phishing "
        f"simulation on behalf of <b>{org_name}</b>. I confirm that this simulation is conducted "
        f"for legitimate security awareness training purposes under the lawful basis of "
        f"<b>{lawful_basis}</b>, and that all applicable data protection obligations will be met.",
        styles["PhishBody"]
    ))
    story.append(Spacer(1, 24))

    # Signature line
    sig_data = [
        ["Authorized By:", admin_email],
        ["Date:", datetime.now(timezone.utc).strftime("%B %d, %Y")],
        ["Document Reference:", f"PHISHSIM-AUTH-{campaign_id[:8].upper()}"],
    ]
    sig_table = Table(sig_data, colWidths=[4 * cm, 12 * cm])
    sig_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (1, 0), (1, 0), 0.5, BRAND_GRAY),
    ]))
    story.append(sig_table)
    story.append(Spacer(1, 20))

    # Footer
    story.append(HRFlowable(width="100%", thickness=1, color=BRAND_LIGHT, spaceAfter=8))
    story.append(Paragraph(
        "This document was auto-generated by PhishSim. "
        "Retain this document as part of your GDPR Article 30 Records of Processing Activities.",
        styles["PhishSmall"]
    ))

    doc.build(story)
    return buffer.getvalue()


def generate_erasure_receipt_pdf(
    alias: str,
    erased_at: datetime,
    records_deleted: dict,
    actor_email: str,
    campaign_id: str,
) -> bytes:
    """Generate a GDPR Article 17 erasure receipt PDF."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2.5 * cm,
        leftMargin=2.5 * cm,
        topMargin=2.5 * cm,
        bottomMargin=2.5 * cm,
    )
    styles = _base_styles()
    story = []

    story.append(Paragraph("PhishSim", styles["PhishTitle"]))
    story.append(Paragraph("GDPR Article 17 — Right to Erasure Receipt", styles["PhishSubtitle"]))
    story.append(HRFlowable(width="100%", thickness=2, color=BRAND_RED, spaceAfter=20))

    story.append(Paragraph(
        "This document confirms that the erasure request has been fulfilled in accordance "
        "with GDPR Article 17 (Right to Erasure / Right to be Forgotten).",
        styles["PhishBody"]
    ))
    story.append(Spacer(1, 12))

    details = [
        ["Employee Alias", alias],
        ["Erased At", erased_at.strftime("%Y-%m-%d %H:%M:%S UTC")],
        ["Requested By", actor_email],
        ["Campaign ID", campaign_id],
        ["Receipt Reference", f"PHISHSIM-ERASURE-{alias}"],
    ]
    table = Table(details, colWidths=[5 * cm, 11 * cm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), BRAND_LIGHT),
        ("TEXTCOLOR", (0, 0), (0, -1), BRAND_GRAY),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(table)
    story.append(Spacer(1, 16))

    story.append(Paragraph("Records Deleted", styles["PhishHeading"]))
    for table_name, count in records_deleted.items():
        story.append(Paragraph(f"✓  {table_name}: {count} record(s) deleted", styles["PhishBody"]))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=BRAND_LIGHT, spaceAfter=8))
    story.append(Paragraph(
        "This erasure receipt was auto-generated by PhishSim. "
        "Retain this document as evidence of GDPR Article 17 compliance.",
        styles["PhishSmall"]
    ))

    doc.build(story)
    return buffer.getvalue()


def generate_campaign_report_pdf(report: dict) -> bytes:
    """Generate a full campaign report PDF."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2.5 * cm,
        bottomMargin=2 * cm,
    )
    styles = _base_styles()
    story = []

    # Header
    story.append(Paragraph("PhishSim", styles["PhishTitle"]))
    story.append(Paragraph("Campaign Security Awareness Report", styles["PhishSubtitle"]))
    story.append(HRFlowable(width="100%", thickness=2, color=BRAND_BLUE, spaceAfter=16))

    # Campaign info
    story.append(Paragraph("Campaign Overview", styles["PhishHeading"]))
    info = [
        ["Campaign", report.get("campaign_name", "")],
        ["Organization", report.get("org_name", "")],
        ["Scenario", report.get("scenario_type", "")],
        ["Difficulty", report.get("difficulty", "")],
        ["Generated", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")],
    ]
    info_table = Table(info, colWidths=[4 * cm, 12 * cm])
    info_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), BRAND_LIGHT),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 16))

    # Stats
    story.append(Paragraph("Results Summary", styles["PhishHeading"]))
    total = report.get("total_targeted", 0)
    stats = [
        ["Metric", "Count", "Rate", "Benchmark"],
        ["Emails Sent", str(total), "—", "—"],
        ["Opened", str(report.get("total_opened", 0)),
         f"{report.get('open_rate', 0):.1f}%", "—"],
        ["Clicked Link", str(report.get("total_clicked", 0)),
         f"{report.get('click_rate', 0):.1f}%", "32%"],
        ["Credentials Entered", str(report.get("total_creds", 0)),
         f"{report.get('cred_rate', 0):.1f}%", "—"],
        ["Risk Score", "—", f"{report.get('risk_score', 0):.1f}%", "32%"],
    ]
    stats_table = Table(stats, colWidths=[5 * cm, 3 * cm, 3 * cm, 3 * cm])
    stats_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 7),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
    ]))
    story.append(stats_table)
    story.append(Spacer(1, 16))

    # Employee breakdown
    story.append(Paragraph("Employee Breakdown (Pseudonymised)", styles["PhishHeading"]))
    emp_data = [["Alias", "Role", "Opened", "Clicked", "Creds", "Risk"]]
    for emp in report.get("employees", []):
        emp_data.append([
            emp.get("alias", ""),
            emp.get("role_generic", ""),
            "✓" if emp.get("opened") else "—",
            "✓" if emp.get("clicked") else "—",
            "✓" if emp.get("cred_entered") else "—",
            emp.get("risk_level", "Low"),
        ])

    emp_table = Table(emp_data, colWidths=[3.5 * cm, 4 * cm, 2 * cm, 2 * cm, 2 * cm, 2.5 * cm])
    emp_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("PADDING", (0, 0), (-1, -1), 6),
        ("ALIGN", (2, 0), (-1, -1), "CENTER"),
    ]))
    story.append(emp_table)
    story.append(Spacer(1, 20))

    # Footer
    story.append(HRFlowable(width="100%", thickness=1, color=BRAND_LIGHT, spaceAfter=8))
    story.append(Paragraph(
        "CONFIDENTIAL — This report contains pseudonymised security awareness training data. "
        "Handle in accordance with your organization's data protection policy. "
        "Generated by PhishSim.",
        styles["PhishSmall"]
    ))

    doc.build(story)
    return buffer.getvalue()
