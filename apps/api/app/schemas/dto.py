from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, HttpUrl


PIPELINE_STATUSES = ["New", "Qualified", "Email Generated", "Sent", "Opened", "Replied", "Meeting", "Won", "Lost"]


class LeadFinderRequest(BaseModel):
    niche: str = Field(min_length=2, max_length=120)
    country: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=1, max_length=120)


class LeadCreate(BaseModel):
    company: str = Field(min_length=1, max_length=220)
    website: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    campaign_id: Optional[UUID] = None
    status: str = "New"


class LeadUpdate(BaseModel):
    company: Optional[str] = None
    website: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[EmailStr] = None
    status: Optional[str] = None
    campaign_id: Optional[UUID] = None
    notes: Optional[str] = None


class BulkLeadAction(BaseModel):
    ids: list[UUID]
    status: Optional[str] = None
    campaign_id: Optional[UUID] = None
    delete: bool = False


class LeadOut(BaseModel):
    id: Optional[UUID] = None
    company: str
    website: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    niche: Optional[str] = None
    status: str = "New"
    campaign_id: Optional[UUID] = None
    campaign: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PaginatedLeads(BaseModel):
    items: list[LeadOut]
    total: int
    page: int
    page_size: int


class AnalyzeRequest(BaseModel):
    lead_id: Optional[UUID] = None
    website: HttpUrl
    company: str
    niche: Optional[str] = None


class AnalysisOut(BaseModel):
    niche: str
    services: List[str]
    strengths: List[str]
    weaknesses: List[str]
    summary: str


class CampaignCreate(BaseModel):
    name: str = Field(min_length=2, max_length=220)
    industry: str = Field(default="", max_length=160)
    countries: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)
    company_size: Optional[str] = None
    keywords: list[str] = Field(default_factory=list)
    website_filters: list[str] = Field(default_factory=list)
    language: str = "English"
    offer: str = Field(default="", max_length=2000)
    cta: str = "Book a quick call"
    email_tone: str = "Professional"
    signature: str = ""
    schedule_at: Optional[datetime] = None
    follow_up_days: int = Field(default=3, ge=1, le=30)


class CampaignUpdate(CampaignCreate):
    status: Optional[str] = None


class CampaignOut(BaseModel):
    id: UUID
    name: str
    industry: str
    countries: list[str]
    cities: list[str]
    company_size: Optional[str]
    keywords: list[str]
    website_filters: list[str]
    language: str
    offer: str
    cta: str
    email_tone: str
    signature: str
    status: str
    schedule_at: Optional[datetime]
    follow_up_days: int
    leads: int = 0
    sent: int = 0
    replies: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class PersonalizeRequest(BaseModel):
    company: str
    niche: str
    website_summary: str
    offer: str = "AI-powered lead generation and outbound growth"


class GenerateEmailRequest(BaseModel):
    campaign_id: UUID
    lead_id: UUID


class EmailVariantOut(BaseModel):
    subject: str = ""
    preview: str = ""
    full_email: str = ""
    cta: str = ""
    cold_email: str = ""
    follow_ups: List[str] = Field(default_factory=list)
    ab_tests: List[str] = Field(default_factory=list)


class EmailUpdate(BaseModel):
    subject: Optional[str] = None
    preview: Optional[str] = None
    body: Optional[str] = None
    cta: Optional[str] = None


class EmailOut(BaseModel):
    id: UUID
    campaign_id: Optional[UUID]
    lead_id: Optional[UUID]
    subject: str
    preview: str
    body: str
    cta: str
    created_at: datetime

    class Config:
        from_attributes = True


class DashboardMetrics(BaseModel):
    leads: int
    campaigns: int
    emails_sent: int
    open_rate: float
    reply_rate: float
    meetings: int
    revenue: float
    mrr: float


class ActivityOut(BaseModel):
    id: UUID
    action: str
    metadata_json: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class NotificationOut(BaseModel):
    id: UUID
    kind: str
    title: str
    message: str
    read_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileOut(BaseModel):
    workspace: str
    company: str
    avatar_url: Optional[str]
    timezone: str
    language: str

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    workspace: str = "Outreach workspace"
    company: str = ""
    avatar_url: Optional[str] = None
    timezone: str = "UTC"
    language: str = "English"


class SettingsOut(BaseModel):
    general: dict[str, Any]
    ai: dict[str, Any]
    email: dict[str, Any]
    billing: dict[str, Any]
    security: dict[str, Any]
    api: dict[str, Any]

    class Config:
        from_attributes = True


class SettingsUpdate(SettingsOut):
    pass


class CheckoutRequest(BaseModel):
    plan: str
    success_url: HttpUrl
    cancel_url: HttpUrl
