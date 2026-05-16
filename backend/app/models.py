"""
Pydantic models for all request/response schemas.
"""
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, List
from enum import Enum
from datetime import datetime
import uuid
import re


# ============================================================
# ENUMS
# ============================================================

class CampaignStatus(str, Enum):
    draft = "draft"
    active = "active"
    completed = "completed"


class ScenarioType(str, Enum):
    it_support = "IT Support"
    hr = "HR"
    finance = "Finance"
    ceo_fraud = "CEO Fraud"
    vendor = "Vendor"


class DifficultyLevel(str, Enum):
    low = "Low"
    medium = "Medium"
    high = "High"


class LawfulBasis(str, Enum):
    legitimate_interest = "Legitimate Interest"
    employee_contract = "Employee Contract"
    legal_obligation = "Legal Obligation"


class EventType(str, Enum):
    open = "open"
    click = "click"
    cred_entered = "cred_entered"


# ============================================================
# ORGANIZATION
# ============================================================

class OrganizationCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    domain: str = Field(..., min_length=3, max_length=100)

    @field_validator("domain")
    @classmethod
    def validate_domain(cls, v: str) -> str:
        v = v.lower().strip().lstrip("@")
        if not re.match(r"^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$", v):
            raise ValueError("Invalid domain format")
        return v


class OrganizationResponse(BaseModel):
    id: str
    name: str
    domain: str
    created_at: datetime


# ============================================================
# CAMPAIGN
# ============================================================

class CampaignCreate(BaseModel):
    org_id: str
    name: str = Field(..., min_length=2, max_length=200)
    scenario_type: ScenarioType
    difficulty: DifficultyLevel
    notes: Optional[str] = Field(None, max_length=2000)


class CampaignConsentUpdate(BaseModel):
    lawful_basis: LawfulBasis
    consent_signed: bool
    admin_confirms_authority: bool

    @model_validator(mode="after")
    def check_consent(self) -> "CampaignConsentUpdate":
        if self.consent_signed and not self.admin_confirms_authority:
            raise ValueError("Admin must confirm authority before signing consent.")
        return self


class CampaignResponse(BaseModel):
    id: str
    org_id: Optional[str] = None
    name: str
    scenario_type: str
    difficulty: str
    status: str
    consent_signed: bool
    lawful_basis: Optional[str]
    created_by: str
    created_at: datetime
    auto_delete_at: datetime
    launched_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    org_name: Optional[str] = None
    org_domain: Optional[str] = None
    total_employees: Optional[int] = 0
    total_opens: Optional[int] = 0
    total_clicks: Optional[int] = 0
    total_creds: Optional[int] = 0
    retention_days_remaining: Optional[float] = None
    notes: Optional[str] = None


# ============================================================
# EMPLOYEE (pseudonymised)
# ============================================================

class EmployeeCSVRow(BaseModel):
    email: EmailStr
    role: str
    real_name: Optional[str] = None  # Only used during upload, never stored in employees table


class EmployeeUploadResult(BaseModel):
    loaded: int
    rejected: int
    rejected_emails: List[str]
    preview: List[dict]  # alias + role only, no email


class EmployeeResponse(BaseModel):
    id: str
    campaign_id: str
    alias: str
    role_generic: str
    uuid: str
    created_at: datetime
    # email intentionally omitted from default response


# ============================================================
# EVENTS
# ============================================================

class EventCreate(BaseModel):
    employee_id: str
    campaign_id: str
    event_type: EventType
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None


class EventResponse(BaseModel):
    id: str
    employee_id: str
    campaign_id: str
    event_type: str
    timestamp: datetime


# ============================================================
# CAMPAIGN REPORT
# ============================================================

class EmployeeRiskLevel(str, Enum):
    low = "Low"
    medium = "Medium"
    high = "High"


class EmployeeReportRow(BaseModel):
    alias: str
    role_generic: str
    opened: bool
    clicked: bool
    cred_entered: bool
    risk_level: EmployeeRiskLevel
    remediation: Optional[str] = None  # AI-generated


class CampaignReport(BaseModel):
    campaign_id: str
    campaign_name: str
    scenario_type: str
    difficulty: str
    org_name: str
    total_targeted: int
    total_opened: int
    total_clicked: int
    total_creds: int
    open_rate: float
    click_rate: float
    cred_rate: float
    risk_score: float
    industry_benchmark: float = 32.0
    employees: List[EmployeeReportRow]
    generated_at: datetime


# ============================================================
# GDPR
# ============================================================

class ErasureResponse(BaseModel):
    alias: str
    erased_at: datetime
    records_deleted: dict
    receipt_available: bool = True


class AuditLogEntry(BaseModel):
    id: str
    actor_email: str
    action: str
    target_table: Optional[str]
    target_id: Optional[str]
    ip_address: Optional[str]
    metadata: Optional[dict]
    timestamp: datetime


class AuditLogPage(BaseModel):
    items: List[AuditLogEntry]
    total: int
    page: int
    page_size: int


class ConsentPDFRequest(BaseModel):
    campaign_id: str
    admin_email: str
    lawful_basis: LawfulBasis
    org_name: str
    campaign_name: str
    campaign_scope: str


# ============================================================
# LLM
# ============================================================

class GeneratedEmail(BaseModel):
    alias: str
    employee_uuid: str
    subject: str
    body_html: str
    tracking_pixel_url: str
    cta_url: str


# ============================================================
# GENERIC RESPONSES
# ============================================================

class SuccessResponse(BaseModel):
    success: bool = True
    message: str
    status: Optional[str] = None
    task_id: Optional[str] = None


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    detail: Optional[str] = None
