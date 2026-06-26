from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LeadStatus(str, enum.Enum):
    new = "New"
    qualified = "Qualified"
    contacted = "Contacted"
    interested = "Interested"
    email_generated = "Email Generated"
    sent = "Sent"
    opened = "Opened"
    replied = "Replied"
    meeting = "Meeting"
    won = "Won"
    lost = "Lost"
    archive = "Archive"


class CampaignStatus(str, enum.Enum):
    draft = "Draft"
    scheduled = "Scheduled"
    running = "Running"
    paused = "Paused"
    stopped = "Stopped"


class SalesEmployeeMode(str, enum.Enum):
    review = "Review Mode"
    semi_auto = "Semi-Auto Mode"
    autonomous = "Autonomous Mode"


class NotificationKind(str, enum.Enum):
    success = "success"
    error = "error"
    warning = "warning"
    info = "info"


class WorkspaceRole(str, enum.Enum):
    owner = "Owner"
    admin = "Admin"
    manager = "Manager"
    member = "Member"


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(180), default="Outreach workspace")
    company: Mapped[str] = mapped_column(String(180), default="")
    industry: Mapped[str] = mapped_column(String(160), default="")
    target_country: Mapped[str] = mapped_column(String(120), default="")
    target_customer: Mapped[str] = mapped_column(String(240), default="")
    timezone: Mapped[str] = mapped_column(String(80), default="UTC")
    language: Mapped[str] = mapped_column(String(80), default="English")
    onboarding_step: Mapped[int] = mapped_column(Integer, default=1)
    onboarding_completed: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_member_user"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    email: Mapped[str] = mapped_column(String(320), default="")
    role: Mapped[WorkspaceRole] = mapped_column(Enum(WorkspaceRole), default=WorkspaceRole.member)
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    workspace: Mapped[Workspace] = relationship()


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("workspace_id", "period", name="uq_workspace_usage_period"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)
    leads: Mapped[int] = mapped_column(Integer, default=0)
    ai_generations: Mapped[int] = mapped_column(Integer, default=0)
    email_sends: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    workspace: Mapped[Workspace] = relationship()


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clerk_user_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    name: Mapped[Optional[str]] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(32), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    plan: Mapped[str] = mapped_column(String(32), default="Starter")
    status: Mapped[str] = mapped_column(String(64), default="trialing")
    trial_end: Mapped[Optional[datetime]] = mapped_column(DateTime)
    current_period_end: Mapped[Optional[datetime]] = mapped_column(DateTime)
    plan_limits: Mapped[dict] = mapped_column(JSON, default=dict)
    user: Mapped[User] = relationship()


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(220))
    industry: Mapped[str] = mapped_column(String(160), default="")
    countries: Mapped[list[str]] = mapped_column(JSON, default=list)
    cities: Mapped[list[str]] = mapped_column(JSON, default=list)
    company_size: Mapped[Optional[str]] = mapped_column(String(80))
    keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    website_filters: Mapped[list[str]] = mapped_column(JSON, default=list)
    language: Mapped[str] = mapped_column(String(80), default="English")
    offer: Mapped[str] = mapped_column(Text, default="")
    cta: Mapped[str] = mapped_column(String(220), default="Book a quick call")
    email_tone: Mapped[str] = mapped_column(String(80), default="Professional")
    signature: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[CampaignStatus] = mapped_column(Enum(CampaignStatus), default=CampaignStatus.draft)
    schedule_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    follow_up_days: Mapped[int] = mapped_column(Integer, default=3)
    timezone: Mapped[str] = mapped_column(String(80), default="UTC")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CampaignSequence(Base):
    __tablename__ = "campaign_sequences"
    __table_args__ = (UniqueConstraint("campaign_id", "step_order", name="uq_campaign_sequence_step"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    step_order: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    subject: Mapped[str] = mapped_column(String(300), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    delay_days: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    campaign: Mapped[Campaign] = relationship()


class AISalesEmployee(Base):
    __tablename__ = "ai_sales_employees"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(160), default="AI Sales Development Representative")
    product_service: Mapped[str] = mapped_column(Text, default="")
    target_customer: Mapped[str] = mapped_column(String(240), default="")
    target_countries: Mapped[list[str]] = mapped_column(JSON, default=list)
    target_industries: Mapped[list[str]] = mapped_column(JSON, default=list)
    offer: Mapped[str] = mapped_column(Text, default="")
    cta: Mapped[str] = mapped_column(String(220), default="Book a quick call")
    sending_mode: Mapped[SalesEmployeeMode] = mapped_column(Enum(SalesEmployeeMode), default=SalesEmployeeMode.review)
    daily_limit: Mapped[int] = mapped_column(Integer, default=25)
    working_hours: Mapped[str] = mapped_column(String(80), default="09:00-17:00")
    tone: Mapped[str] = mapped_column(String(80), default="Professional")
    language: Mapped[str] = mapped_column(String(80), default="English")
    signature: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    strict_limits: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    workspace: Mapped[Workspace] = relationship()


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = (UniqueConstraint("user_id", "email", name="uq_user_lead_email"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    campaign_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"), index=True)
    sales_employee_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("ai_sales_employees.id", ondelete="SET NULL"), index=True)
    company: Mapped[str] = mapped_column(String(220))
    website: Mapped[Optional[str]] = mapped_column(String(500))
    industry: Mapped[Optional[str]] = mapped_column(String(160))
    country: Mapped[Optional[str]] = mapped_column(String(120))
    city: Mapped[Optional[str]] = mapped_column(String(120))
    contact: Mapped[Optional[str]] = mapped_column(String(160))
    email: Mapped[Optional[str]] = mapped_column(String(320))
    phone: Mapped[Optional[str]] = mapped_column(String(80))
    linkedin: Mapped[Optional[str]] = mapped_column(String(500))
    niche: Mapped[Optional[str]] = mapped_column(String(120))
    status: Mapped[LeadStatus] = mapped_column(Enum(LeadStatus), default=LeadStatus.new)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    revenue: Mapped[float] = mapped_column(Numeric, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    campaign: Mapped[Optional[Campaign]] = relationship()
    sales_employee: Mapped[Optional[AISalesEmployee]] = relationship()


class SalesEmployeeLeadInsight(Base):
    __tablename__ = "sales_employee_lead_insights"
    __table_args__ = (UniqueConstraint("sales_employee_id", "lead_id", name="uq_sales_employee_lead_insight"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    sales_employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_sales_employees.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    industry: Mapped[str] = mapped_column(String(160), default="")
    services: Mapped[list[str]] = mapped_column(JSON, default=list)
    pain_points: Mapped[list[str]] = mapped_column(JSON, default=list)
    icp_score: Mapped[int] = mapped_column(Integer, default=0)
    purchase_probability: Mapped[int] = mapped_column(Integer, default=0)
    best_sales_angle: Mapped[str] = mapped_column(Text, default="")
    best_cta: Mapped[str] = mapped_column(String(220), default="")
    recommended_plan: Mapped[str] = mapped_column(String(120), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    employee: Mapped[AISalesEmployee] = relationship()
    lead: Mapped[Lead] = relationship()


class WebsiteAnalysis(Base):
    __tablename__ = "website_analyses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    company: Mapped[str] = mapped_column(String(220), default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    industry: Mapped[Optional[str]] = mapped_column(String(160))
    location: Mapped[Optional[str]] = mapped_column(String(160))
    niche: Mapped[Optional[str]] = mapped_column(String(120))
    products_services: Mapped[list[str]] = mapped_column(JSON, default=list)
    services: Mapped[list[str]] = mapped_column(JSON, default=list)
    technologies: Mapped[list[str]] = mapped_column(JSON, default=list)
    strengths: Mapped[list[str]] = mapped_column(JSON, default=list)
    weaknesses: Mapped[list[str]] = mapped_column(JSON, default=list)
    summary: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class EmailMessage(Base):
    __tablename__ = "email_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    campaign_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"))
    lead_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"))
    direction: Mapped[str] = mapped_column(String(16), default="outbound")
    subject: Mapped[str] = mapped_column(String(300))
    preview: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text)
    cta: Mapped[str] = mapped_column(String(220), default="")
    follow_up_1: Mapped[str] = mapped_column(Text, default="")
    follow_up_2: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[dict] = mapped_column(JSON, default=dict)
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(160), index=True)
    delivery_status: Mapped[str] = mapped_column(String(40), default="draft")
    opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    clicked_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    bounced_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    replied_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    reply_body: Mapped[Optional[str]] = mapped_column(Text)
    reply_assistant: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    value: Mapped[Optional[float]] = mapped_column(Numeric)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(128), index=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64))
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    kind: Mapped[NotificationKind] = mapped_column(Enum(NotificationKind), default=NotificationKind.info)
    title: Mapped[str] = mapped_column(String(180))
    message: Mapped[str] = mapped_column(Text)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WorkspaceProfile(Base):
    __tablename__ = "workspace_profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    workspace: Mapped[str] = mapped_column(String(180), default="Outreach workspace")
    company: Mapped[str] = mapped_column(String(180), default="")
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500))
    timezone: Mapped[str] = mapped_column(String(80), default="UTC")
    language: Mapped[str] = mapped_column(String(80), default="English")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    workspace_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    general: Mapped[dict] = mapped_column(JSON, default=dict)
    ai: Mapped[dict] = mapped_column(JSON, default=dict)
    email: Mapped[dict] = mapped_column(JSON, default=dict)
    billing: Mapped[dict] = mapped_column(JSON, default=dict)
    security: Mapped[dict] = mapped_column(JSON, default=dict)
    api: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
