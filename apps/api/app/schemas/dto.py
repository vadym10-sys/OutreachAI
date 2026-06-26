from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, HttpUrl


PIPELINE_STATUSES = ["New", "Qualified", "Contacted", "Interested", "Meeting", "Won", "Lost", "Archive"]

PLAN_LIMITS = {
    "Starter": {"leads": 500, "ai_generations": 1000, "email_sends": 1000, "team_members": 2, "mrr": 49},
    "Pro": {"leads": 2500, "ai_generations": 7500, "email_sends": 7500, "team_members": 8, "mrr": 149},
    "Agency": {"leads": 20000, "ai_generations": 50000, "email_sends": 50000, "team_members": 30, "mrr": 499},
}


class LeadFinderRequest(BaseModel):
    niche: str = Field(default="", max_length=120)
    industry: str = Field(default="", max_length=120)
    country: str = Field(min_length=2, max_length=120)
    city: str = Field(default="", max_length=120)
    employee_count: Optional[str] = None
    revenue: Optional[str] = None
    technologies: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    limit: int = Field(default=10, ge=1, le=25)


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
    notes: Optional[str] = None
    revenue: float = 0
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
    company: str = ""
    niche: Optional[str] = None


class AnalysisOut(BaseModel):
    company: str = ""
    website: str = ""
    description: str = ""
    industry: Optional[str] = None
    location: Optional[str] = None
    niche: str
    products_services: List[str] = Field(default_factory=list)
    services: List[str]
    technologies: List[str] = Field(default_factory=list)
    strengths: List[str]
    weaknesses: List[str]
    icp_score: int = Field(default=0, ge=0, le=100)
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
    timezone: str = "UTC"
    working_hours: str = "09:00-17:00"
    daily_send_limit: int = Field(default=50, ge=1, le=500)
    sequence: list["CampaignSequenceIn"] = Field(default_factory=list)


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
    timezone: str = "UTC"
    working_hours: str = "09:00-17:00"
    daily_send_limit: int = 50
    sequence: list["CampaignSequenceOut"] = Field(default_factory=list)
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
    cta: str = "Book a quick call"
    tone: str = "Professional"
    language: str = "English"
    signature: str = ""


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


class RewriteEmailRequest(BaseModel):
    body: str
    tone: str = "Professional"
    instruction: str = "Improve clarity and personalization without increasing length."


class ReplyAssistantRequest(BaseModel):
    company: str
    reply_body: str
    campaign_offer: str = ""


class ReplyAssistantOut(BaseModel):
    suggested_response: str
    next_step: str
    qualification_score: int = Field(ge=0, le=100)


class EmailUpdate(BaseModel):
    subject: Optional[str] = None
    preview: Optional[str] = None
    body: Optional[str] = None
    cta: Optional[str] = None
    follow_up_1: Optional[str] = None
    follow_up_2: Optional[str] = None


class EmailOut(BaseModel):
    id: UUID
    campaign_id: Optional[UUID]
    lead_id: Optional[UUID]
    subject: str
    preview: str
    body: str
    cta: str
    follow_up_1: str = ""
    follow_up_2: str = ""
    follow_up_3: str = ""
    delivery_status: str = "draft"
    sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    opened_at: Optional[datetime] = None
    bounced_at: Optional[datetime] = None
    replied_at: Optional[datetime] = None
    reply_assistant: dict[str, Any] = Field(default_factory=dict)
    tags: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    class Config:
        from_attributes = True


class DashboardMetrics(BaseModel):
    leads: int
    campaigns: int
    emails_sent: int
    delivered: int = 0
    opened: int = 0
    replies: int = 0
    bounces: int = 0
    open_rate: float
    reply_rate: float
    ctr: float = 0
    conversion_rate: float = 0
    meetings: int
    revenue: float
    revenue_forecast: float = 0
    mrr: float
    arr: float = 0
    revenue_series: list[dict[str, Any]] = Field(default_factory=list)
    funnel: list[dict[str, Any]] = Field(default_factory=list)
    pipeline: list[dict[str, Any]] = Field(default_factory=list)
    plan: str = "Starter"
    usage: dict[str, Any] = Field(default_factory=dict)


class CampaignSequenceIn(BaseModel):
    step_order: int = Field(ge=1, le=4)
    name: str = Field(default="", max_length=120)
    subject: str = Field(default="", max_length=300)
    body: str = ""
    delay_days: int = Field(default=0, ge=0, le=60)


class CampaignSequenceOut(CampaignSequenceIn):
    id: UUID

    class Config:
        from_attributes = True


class WorkspaceMemberOut(BaseModel):
    id: UUID
    user_id: str
    email: str
    role: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class WorkspaceOut(BaseModel):
    id: UUID
    name: str
    company: str
    industry: str
    target_country: str
    target_customer: str
    timezone: str
    language: str
    onboarding_step: int
    onboarding_completed: bool
    members: list[WorkspaceMemberOut] = Field(default_factory=list)


class WorkspaceUpdate(BaseModel):
    name: str = "Outreach workspace"
    company: str = ""
    industry: str = ""
    target_country: str = ""
    target_customer: str = ""
    timezone: str = "UTC"
    language: str = "English"


class OnboardingUpdate(BaseModel):
    company: str = ""
    industry: str = ""
    target_country: str = ""
    target_customer: str = ""
    connect_openai: bool = False
    launch_first_campaign: bool = False
    step: int = Field(default=1, ge=1, le=6)


class MemberInvite(BaseModel):
    email: EmailStr
    role: str = "Member"


class BillingPlanOut(BaseModel):
    name: str
    price: int
    limits: dict[str, int]
    current: bool = False


class BillingPortalRequest(BaseModel):
    return_url: HttpUrl


class InvoiceOut(BaseModel):
    id: str
    status: str
    amount_due: int
    hosted_invoice_url: Optional[str] = None
    created: Optional[datetime] = None


class UsageOut(BaseModel):
    plan: str
    period: str
    limits: dict[str, int]
    usage: dict[str, int]


class AdminSummaryOut(BaseModel):
    users: int
    workspaces: int
    subscriptions: int
    revenue: float
    usage: dict[str, int]
    system_health: dict[str, Any]


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
