from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, HttpUrl


PIPELINE_STATUSES = ["New", "Qualified", "Contacted", "Interested", "Meeting", "Won", "Lost", "Archive"]
CRM_STAGES = [
    "New Lead",
    "Qualified",
    "Website Analyzed",
    "Contact Found",
    "Email Draft Ready",
    "Approved",
    "Sent",
    "Replied",
    "Meeting Scheduled",
    "Won",
    "Lost",
]
SALES_EMPLOYEE_MODES = ["Review Mode", "Semi-Auto Mode", "Autonomous Mode"]

PLAN_LIMITS = {
    "Starter": {
        "mrr": 49,
        "leads": 500,
        "ai_generations": 1000,
        "email_sends": 1000,
        "sales_employees": 1,
        "workspaces": 1,
        "team_members": 1,
        "campaigns": 3,
        "review_mode": True,
        "semi_auto_mode": False,
        "autonomous_mode": False,
        "basic_analytics": True,
        "advanced_analytics": False,
        "reply_ai": False,
        "api_access": False,
        "webhooks": False,
        "white_label": False,
    },
    "Pro": {
        "mrr": 149,
        "leads": 5000,
        "ai_generations": 10000,
        "email_sends": 10000,
        "sales_employees": 3,
        "workspaces": 3,
        "team_members": 10,
        "campaigns": 25,
        "review_mode": True,
        "semi_auto_mode": True,
        "autonomous_mode": False,
        "basic_analytics": True,
        "advanced_analytics": True,
        "reply_ai": True,
        "api_access": False,
        "webhooks": False,
        "white_label": False,
    },
    "Agency": {
        "mrr": 499,
        "leads": 50000,
        "ai_generations": 100000,
        "email_sends": 100000,
        "sales_employees": 10,
        "workspaces": 0,
        "team_members": 0,
        "campaigns": 0,
        "review_mode": True,
        "semi_auto_mode": True,
        "autonomous_mode": True,
        "basic_analytics": True,
        "advanced_analytics": True,
        "reply_ai": True,
        "api_access": True,
        "webhooks": True,
        "white_label": True,
    },
}


class LeadFinderRequest(BaseModel):
    niche: str = Field(default="", max_length=120)
    industry: str = Field(default="", max_length=120)
    category: str = Field(default="", max_length=120)
    keyword: str = Field(default="", max_length=160)
    country: str = Field(min_length=2, max_length=120)
    city: str = Field(default="", max_length=120)
    company_size: Optional[str] = None
    employee_count: Optional[str] = None
    revenue: Optional[str] = None
    technologies: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    radius: int = Field(default=10000, ge=100, le=50000)
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


class CrmStageUpdate(BaseModel):
    stage: str = Field(max_length=80)


class CrmNoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


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
    sales_employee_id: Optional[UUID] = None
    campaign: Optional[str] = None
    notes: Optional[str] = None
    revenue: float = 0
    created_at: Optional[datetime] = None
    domain: Optional[str] = None
    employee_count: Optional[int] = None
    revenue_range: Optional[str] = None
    title: Optional[str] = None
    confidence: Optional[str] = None
    address: Optional[str] = None
    google_rating: Optional[float] = None
    business_category: Optional[str] = None
    place_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    apollo_company_id: Optional[str] = None
    apollo_contact_id: Optional[str] = None
    hunter_contact_id: Optional[str] = None
    hunter_verified: bool = False
    hunter_status: Optional[str] = None
    source: Optional[str] = None
    ai_summary: Optional[str] = None
    suggested_offer: Optional[str] = None
    outreach_strategy: Optional[str] = None
    sales_angle: Optional[str] = None
    expected_reply_rate: Optional[str] = None
    buying_signals: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    opportunity_analysis: str = ""
    partnership_fit: str = ""
    priority_score: Optional[int] = None
    confidence_score: Optional[int] = None
    next_recommended_action: str = ""
    found_at: Optional[datetime] = None
    saved_to_crm_at: Optional[datetime] = None
    website_analyzed_at: Optional[datetime] = None
    contact_found_at: Optional[datetime] = None
    email_generated_at: Optional[datetime] = None
    email_approved_at: Optional[datetime] = None
    email_sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    opened_at: Optional[datetime] = None
    replied_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    stage_changed_at: Optional[datetime] = None
    contact_search_checked_at: Optional[datetime] = None
    contact_search_status: Optional[str] = None
    contact_search_message: Optional[str] = None
    decision_maker_roles_searched: list[str] = Field(default_factory=list)
    workflow_stages: dict[str, str] = Field(default_factory=dict)
    workflow_stage_messages: dict[str, str] = Field(default_factory=dict)

    class Config:
        from_attributes = True


class CrmContactOut(BaseModel):
    id: UUID
    company_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    company: str = ""
    name: str = ""
    title: str = ""
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    confidence: str = ""
    source: str = "manual"
    email_status: str = "Unknown"
    created_at: datetime

    class Config:
        from_attributes = True


class CrmDealOut(BaseModel):
    id: UUID
    company_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    company: str = ""
    name: str
    stage: str = "New Lead"
    value: float = 0
    probability: int = 0
    source: str = "manual"
    next_step: str = ""
    created_at: datetime

    class Config:
        from_attributes = True


class CrmNoteOut(BaseModel):
    id: UUID
    company_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    body: str
    kind: str = "note"
    created_at: datetime

    class Config:
        from_attributes = True


class CrmCompanyOut(BaseModel):
    id: UUID
    lead_id: Optional[UUID] = None
    name: str
    website: Optional[str] = None
    domain: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    google_rating: Optional[float] = None
    place_id: Optional[str] = None
    source: str = "manual"
    ai_summary: str = ""
    pain_points: list[str] = Field(default_factory=list)
    services: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    icp_score: Optional[int] = None
    value_proposition: str = ""
    suggested_offer: str = ""
    outreach_strategy: str = ""
    sales_angle: str = ""
    recommended_cta: str = ""
    follow_up_strategy: str = ""
    expected_reply_rate: str = ""
    buying_signals: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    opportunity_analysis: str = ""
    partnership_fit: str = ""
    priority_score: Optional[int] = None
    confidence_score: Optional[int] = None
    next_recommended_action: str = ""
    email_status: str = "Not prepared"
    crm_stage: str = "New Lead"
    contacts: list[CrmContactOut] = Field(default_factory=list)
    deals: list[CrmDealOut] = Field(default_factory=list)
    notes: list[CrmNoteOut] = Field(default_factory=list)
    activity: list["ActivityOut"] = Field(default_factory=list)
    generated_emails: list["EmailOut"] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    found_at: Optional[datetime] = None
    saved_to_crm_at: Optional[datetime] = None
    website_analyzed_at: Optional[datetime] = None
    contact_found_at: Optional[datetime] = None
    email_generated_at: Optional[datetime] = None
    email_approved_at: Optional[datetime] = None
    email_sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    opened_at: Optional[datetime] = None
    replied_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    stage_changed_at: Optional[datetime] = None
    contact_search_checked_at: Optional[datetime] = None
    contact_search_status: Optional[str] = None
    contact_search_message: Optional[str] = None
    decision_maker_roles_searched: list[str] = Field(default_factory=list)
    workflow_stages: dict[str, str] = Field(default_factory=dict)
    workflow_stage_messages: dict[str, str] = Field(default_factory=dict)
    deep_contact_search: dict[str, Any] = Field(default_factory=dict)
    intelligence_quality: dict[str, Any] = Field(default_factory=dict)
    technologies: list[str] = Field(default_factory=list)
    last_enriched_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CrmPipelineOut(BaseModel):
    stages: list[str] = Field(default_factory=lambda: CRM_STAGES.copy())
    companies: list[CrmCompanyOut] = Field(default_factory=list)
    deals: list[CrmDealOut] = Field(default_factory=list)


class SalesCopilotOut(BaseModel):
    probability_to_reply: int = Field(ge=0, le=100)
    probability_to_buy: int = Field(ge=0, le=100)
    best_first_contact: str
    best_subject_line: str
    best_cta: str
    estimated_revenue: Optional[float] = None
    estimated_revenue_reason: Optional[str] = None
    reasoning: list[str] = Field(default_factory=list)


class WebsiteAuditOut(BaseModel):
    missing_cta: bool = False
    missing_contact_form: bool = False
    poor_seo: bool = False
    weak_trust_signals: bool = False
    missing_reviews: bool = False
    slow_website: bool = False
    outdated_design: bool = False
    improvement_report: str
    priority_actions: list[str] = Field(default_factory=list)


class MeetingPrepOut(BaseModel):
    company_summary: str
    decision_maker_profile: str
    likely_objections: list[str] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)
    sales_strategy: str


class FollowUpSequenceOut(BaseModel):
    no_open: list[str] = Field(default_factory=list)
    opened: list[str] = Field(default_factory=list)
    clicked: list[str] = Field(default_factory=list)
    replied: list[str] = Field(default_factory=list)


class CampaignAnalyticsOut(BaseModel):
    campaign_id: Optional[UUID] = None
    campaign_success: int = Field(ge=0, le=100)
    predicted_reply_rate: float
    predicted_conversion_rate: float
    suggested_improvements: list[str] = Field(default_factory=list)


class WorkspaceAutomationOut(BaseModel):
    workspace_id: str
    campaign_id: Optional[str] = None
    leads_imported: int = 0
    leads_qualified: int = 0
    emails_generated: int = 0
    emails_sent: int = 0
    follow_ups_sent: int = 0
    meetings_detected: int = 0
    crm_synced: int = 0
    blockers: list[str] = Field(default_factory=list)


class AutomationRunOut(BaseModel):
    workspaces_processed: int = 0
    leads_imported: int = 0
    leads_qualified: int = 0
    emails_generated: int = 0
    emails_sent: int = 0
    follow_ups_sent: int = 0
    meetings_detected: int = 0
    crm_synced: int = 0
    blockers: list[str] = Field(default_factory=list)
    workspaces: list[WorkspaceAutomationOut] = Field(default_factory=list)


class IntegrationStatusOut(BaseModel):
    apollo: bool
    hunter: bool
    clay: bool
    openai: bool
    resend: bool
    crm_sync: bool
    automation_secret: bool


class ApolloIntegrationStatusOut(BaseModel):
    configured: bool
    connected: bool = False
    last_success_at: Optional[datetime] = None
    last_error: str = ""


class ApolloConnectionTestOut(BaseModel):
    configured: bool
    connected: bool
    duration_ms: int = 0
    last_success_at: Optional[datetime] = None
    last_error: str = ""


class HunterIntegrationStatusOut(BaseModel):
    configured: bool
    connected: bool = False
    last_success_at: Optional[datetime] = None
    last_error: str = ""


class HunterConnectionTestOut(BaseModel):
    configured: bool
    connected: bool
    duration_ms: int = 0
    last_success_at: Optional[datetime] = None
    last_error: str = ""


class PaginatedLeads(BaseModel):
    items: list[LeadOut]
    total: int
    page: int
    page_size: int


class AnalyzeRequest(BaseModel):
    lead_id: Optional[UUID] = None
    website: str = Field(min_length=1, max_length=2048)
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
    icp: str = ""
    value_proposition: str = ""
    detected_language: str = ""
    target_geography: str = ""
    sales_angle: str = ""
    company_summary: str = ""
    suggested_offer: str = ""
    outreach_strategy: str = ""
    recommended_tone: str = ""
    recommended_cta: str = ""
    follow_up_strategy: str = ""
    expected_reply_rate: str = ""
    buying_signals: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    opportunity_analysis: str = ""
    partnership_fit: str = ""
    priority_score: int = Field(default=0, ge=0, le=100)
    confidence_score: int = Field(default=0, ge=0, le=100)
    next_recommended_action: str = ""


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


class AISalesEmployeeCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    role: str = Field(default="AI Sales Development Representative", max_length=160)
    product_service: str = Field(default="", max_length=2500)
    target_customer: str = Field(default="", max_length=240)
    target_countries: list[str] = Field(default_factory=list)
    target_industries: list[str] = Field(default_factory=list)
    offer: str = Field(default="", max_length=2500)
    cta: str = Field(default="Book a quick call", max_length=220)
    sending_mode: str = "Review Mode"
    daily_limit: int = Field(default=25, ge=1, le=250)
    working_hours: str = Field(default="09:00-17:00", max_length=80)
    tone: str = Field(default="Professional", max_length=80)
    language: str = Field(default="English", max_length=80)
    signature: str = Field(default="", max_length=1500)


class AISalesEmployeeUpdate(AISalesEmployeeCreate):
    status: str = "active"


class AISalesEmployeeOut(AISalesEmployeeCreate):
    id: UUID
    status: str
    strict_limits: dict[str, Any] = Field(default_factory=dict)
    leads: int = 0
    pending_approval: int = 0
    sent: int = 0
    replies: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class SalesEmployeeLeadImport(BaseModel):
    companies: list[LeadCreate] = Field(default_factory=list)


class WebsiteListImport(BaseModel):
    websites: str


class GoogleMapsImport(BaseModel):
    export_text: str


class SalesEmployeeLeadInsightOut(BaseModel):
    id: UUID
    lead_id: UUID
    sales_employee_id: UUID
    industry: str = ""
    services: list[str] = Field(default_factory=list)
    pain_points: list[str] = Field(default_factory=list)
    icp_score: int = Field(ge=0, le=100)
    purchase_probability: int = Field(ge=0, le=100)
    best_sales_angle: str
    best_cta: str
    recommended_plan: str
    summary: str
    created_at: datetime

    class Config:
        from_attributes = True


class SalesEmployeeRunOut(BaseModel):
    employee_id: UUID
    mode: str
    leads_qualified: int = 0
    emails_generated: int = 0
    emails_sent: int = 0
    blocked: list[str] = Field(default_factory=list)


class SalesEmployeeTaskRequest(BaseModel):
    command: str = Field(min_length=3, max_length=2000)
    transcript_source: str = Field(default="text", max_length=40)


class SalesEmployeeTaskPlanOut(BaseModel):
    id: str
    employee_id: UUID
    command: str
    goal: str
    intent: str
    priority: str
    required_tools: list[str] = Field(default_factory=list)
    estimated_execution_time: str
    expected_result: str
    steps: list[str] = Field(default_factory=list)
    requires_approval: bool = True
    external_actions: list[str] = Field(default_factory=list)
    safety_notes: list[str] = Field(default_factory=list)
    memory_updates: list[str] = Field(default_factory=list)
    status: str = "waiting_approval"
    progress: list[str] = Field(default_factory=list)
    created_at: datetime
    approved_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    result_preview: Optional[dict[str, Any]] = None


class SalesEmployeeTaskDecision(BaseModel):
    plan_id: str
    action: str = Field(pattern="^(approve|cancel)$")
    edits: Optional[str] = Field(default=None, max_length=2000)


class SalesEmployeeTaskResultOut(BaseModel):
    id: UUID
    workspace_id: UUID
    user_id: str
    sales_employee_id: UUID
    task_id: str
    command: str
    status: str
    result_json: dict[str, Any]
    created_at: datetime
    completed_at: Optional[datetime] = None
    employee_name: str = ""
    execution_time_ms: int = 0


class SalesEmployeeTaskActionOut(BaseModel):
    accepted: bool
    action: str
    message: str


class SalesEmployeeMemoryOut(BaseModel):
    previous_tasks: list[dict[str, Any]] = Field(default_factory=list)
    campaigns: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)
    preferred_tone: str = "Professional"
    customer_preferences: list[str] = Field(default_factory=list)


class SalesEmployeePerformanceOut(BaseModel):
    tasks_completed: int = 0
    success_rate: float = 0
    reply_rate: float = 0
    meeting_rate: float = 0
    revenue_influence: float = 0
    time_saved_hours: float = 0


class TeamRouterRequest(BaseModel):
    command: str = Field(min_length=3, max_length=2000)
    transcript_source: str = Field(default="text", max_length=40)


class TeamRouterSubtaskOut(BaseModel):
    id: str
    employee: str
    title: str
    objective: str
    required_tools: list[str] = Field(default_factory=list)
    expected_result: str = ""
    risk_level: str = "Low"
    required_approval: bool = True
    status: str = "waiting_approval"
    result: str = ""


class TeamRouterPlanOut(BaseModel):
    id: str
    command: str
    detected_intent: str
    assigned_employees: list[str] = Field(default_factory=list)
    primary_employee: str
    priority: str = "Medium"
    risk_level: str = "Medium"
    estimated_execution_time: str = "5-10 minutes"
    required_approval: bool = True
    subtasks: list[TeamRouterSubtaskOut] = Field(default_factory=list)
    safety_notes: list[str] = Field(default_factory=list)
    status: str = "waiting_approval"
    progress: list[str] = Field(default_factory=list)
    created_at: datetime
    approved_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class TeamRouterDecision(BaseModel):
    plan_id: str
    action: str = Field(pattern="^(approve|cancel)$")
    edits: Optional[str] = Field(default=None, max_length=2000)


class TeamEmployeeDashboardOut(BaseModel):
    employee: str
    role: str
    active_tasks: int = 0
    completed_tasks: int = 0
    last_activity: str = "No activity yet"
    performance: float = 0
    status: str = "ready"
    tasks: list[dict[str, Any]] = Field(default_factory=list)
    activity: list[str] = Field(default_factory=list)
    results: list[str] = Field(default_factory=list)
    memory: dict[str, Any] = Field(default_factory=dict)


class TeamRouterDashboardOut(BaseModel):
    employees: list[TeamEmployeeDashboardOut] = Field(default_factory=list)
    current_plan: Optional[TeamRouterPlanOut] = None
    history: list[TeamRouterPlanOut] = Field(default_factory=list)


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


class GrowthGoalIn(BaseModel):
    goal: str = Field(min_length=3, max_length=240)


class GrowthGoalOut(BaseModel):
    goal: str = ""
    target_meetings: int = 0
    meetings_booked: int = 0
    progress_percent: float = 0
    execution_plan: list[str] = Field(default_factory=list)
    next_action: str = ""


class GrowthBriefingOut(BaseModel):
    date: str
    new_leads_found: int = 0
    best_opportunities: list[dict[str, Any]] = Field(default_factory=list)
    campaign_performance: dict[str, Any] = Field(default_factory=dict)
    reply_rate_change: float = 0
    meetings_booked: int = 0
    recommended_actions: list[dict[str, Any]] = Field(default_factory=list)


class GrowthEngineOut(BaseModel):
    briefing: GrowthBriefingOut
    opportunity_feed: list[dict[str, Any]] = Field(default_factory=list)
    smart_recommendations: list[dict[str, Any]] = Field(default_factory=list)
    website_monitoring: list[dict[str, Any]] = Field(default_factory=list)
    campaign_optimizations: list[dict[str, Any]] = Field(default_factory=list)
    reply_assistant: list[dict[str, Any]] = Field(default_factory=list)
    revenue_dashboard: dict[str, Any] = Field(default_factory=dict)
    goal: GrowthGoalOut = Field(default_factory=GrowthGoalOut)
    proactive_mode: list[dict[str, Any]] = Field(default_factory=list)
    notifications: list[dict[str, Any]] = Field(default_factory=list)
    performance: dict[str, Any] = Field(default_factory=dict)


class AICEOBriefingRequest(BaseModel):
    length: str = Field(default="1 min", pattern="^(30 sec|1 min|3 min|10 min)$")
    language: str = Field(default="English", pattern="^(English|Russian|Spanish|American English|French|Italian|Polish|Ukrainian)$")


class AICEOBriefingOut(BaseModel):
    id: UUID
    title: str
    length: str
    language: str
    transcript: str
    summary_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    class Config:
        from_attributes = True


class AICEOQuestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    language: str = Field(default="English", pattern="^(English|Russian|Spanish|American English|French|Italian|Polish|Ukrainian)$")


class AICEOAnswerOut(BaseModel):
    answer: str
    related_metrics: dict[str, Any] = Field(default_factory=dict)
    safety_notice: str = "AI CEO only reports and recommends. It cannot launch campaigns, send emails, approve actions, or delete data."


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
    limits: dict[str, Any]
    current: bool = False
    active_subscription: bool = False


class BillingStatusOut(BaseModel):
    plan: str
    price: int
    status: str
    trial_end: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    trial_days_remaining: int = 0
    stripe_customer_id: str = ""
    stripe_subscription_id: str = ""
    last_payment_error: str = ""
    last_decline_code: str = ""
    last_failure_message: str = ""
    last_payment_failed_at: Optional[datetime] = None
    limits: dict[str, Any]
    usage: dict[str, int]
    sales_employees_used: int = 0
    workspaces_used: int = 0


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
    limits: dict[str, Any]
    usage: dict[str, int]


class BillingDiagnosticsOut(BaseModel):
    stripe_secret_loaded: bool
    webhook_secret_loaded: bool
    publishable_key_loaded: bool
    starter_price_id_loaded: bool
    pro_price_id_loaded: bool
    agency_price_id_loaded: bool
    checkout_session_creation_works: bool = False
    webhook_receives_signed_events: bool = False
    subscription_sync_healthy: bool = False


class BillingSyncRequest(BaseModel):
    customer_email: Optional[EmailStr] = None
    stripe_customer_id: Optional[str] = Field(default=None, max_length=128)


class BillingSyncOut(BaseModel):
    synced: bool
    plan: str = "Starter"
    status: str = "inactive"
    stripe_customer_id: str = ""
    stripe_subscription_id: str = ""
    trial_end: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    workspace_id: Optional[UUID] = None
    price_id_loaded: bool = False
    subscription_found: bool = False
    customer_found: bool = False
    message: str = ""


class AdminSummaryOut(BaseModel):
    users: int
    workspaces: int
    subscriptions: int
    revenue: float
    usage: dict[str, int]
    system_health: dict[str, Any]


class OwnerFeatureFlagsOut(BaseModel):
    ai_ceo_voice: bool = False
    experimental_features: bool = False
    admin_nav: bool = False
    analytics_nav: bool = False
    ai_marketplace: bool = False


class OwnerFeatureFlagsUpdate(BaseModel):
    ai_ceo_voice: Optional[bool] = None
    experimental_features: Optional[bool] = None
    admin_nav: Optional[bool] = None
    analytics_nav: Optional[bool] = None
    ai_marketplace: Optional[bool] = None


class ActivityOut(BaseModel):
    id: UUID
    action: str
    metadata_json: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True


class OwnerConsoleOut(BaseModel):
    executive_overview: dict[str, Any]
    revenue: dict[str, float]
    customers: dict[str, int]
    subscriptions: dict[str, int]
    ai_usage: dict[str, int]
    product_analytics: dict[str, Any]
    error_monitoring: dict[str, Any]
    system_health: dict[str, str]
    feature_flags: OwnerFeatureFlagsOut
    audit_logs: list[ActivityOut]


class QualityCheckOut(BaseModel):
    name: str
    module: str
    status: str
    severity: str
    summary: str
    evidence: dict[str, Any] = {}
    suggested_fix: str = ""


class QualityIssueOut(BaseModel):
    id: UUID
    fingerprint: str
    title: str
    module: str
    severity: str
    status: str
    affected_area: str
    root_cause: str
    suggested_fix: str
    evidence_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class QualityRepairTaskOut(BaseModel):
    id: UUID
    issue_id: Optional[UUID]
    title: str
    priority: str
    status: str
    diagnosis: str
    suggested_fix: str
    required_tests: list[str]
    approval_required: bool
    created_at: datetime

    class Config:
        from_attributes = True


class QualityDashboardOut(BaseModel):
    health_score: int
    status: str
    summary: str
    deployment_gate: dict[str, Any]
    checks: list[QualityCheckOut]
    open_bugs: list[QualityIssueOut]
    repair_tasks: list[QualityRepairTaskOut]
    sentry_issues: list[dict[str, Any]]
    failed_integrations: list[QualityCheckOut]
    failed_tests: list[QualityCheckOut]
    broken_flows: list[QualityCheckOut]
    suggested_fixes: list[str]
    last_run_at: Optional[datetime] = None


class QualityRepairTaskCreate(BaseModel):
    fingerprint: str


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


class OutreachSenderUpdate(BaseModel):
    provider: str = Field(default="resend", max_length=40)
    sender_name: str = Field(default="", max_length=120)
    sender_email: Optional[EmailStr] = None
    reply_to: Optional[EmailStr] = None
    daily_send_limit: int = Field(default=25, ge=1, le=200)
    enabled: bool = True
    smtp_host: str = Field(default="", max_length=255)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = Field(default="", max_length=255)
    smtp_password: str = Field(default="", max_length=2048)
    smtp_use_tls: bool = True


class OutreachSenderStatusOut(BaseModel):
    provider: str
    connected: bool
    status: str
    sender_name: str = ""
    sender_email: Optional[str] = None
    reply_to: Optional[str] = None
    daily_send_limit: int = 25
    sent_today: int = 0
    remaining_today: int = 0
    spf_status: str = "not_checked"
    dkim_status: str = "not_checked"
    dmarc_status: str = "not_checked"
    next_action: str
    reason: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_configured: bool = False


class CheckoutRequest(BaseModel):
    plan: str
    success_url: Optional[HttpUrl] = None
    cancel_url: Optional[HttpUrl] = None
