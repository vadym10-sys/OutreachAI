from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, HttpUrl


class LeadFinderRequest(BaseModel):
    niche: str = Field(min_length=2, max_length=120)
    country: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=1, max_length=120)


class LeadOut(BaseModel):
    id: Optional[UUID] = None
    company: str
    website: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    niche: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    status: str = "New"

    class Config:
        from_attributes = True


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


class PersonalizeRequest(BaseModel):
    company: str
    niche: str
    website_summary: str
    offer: str = "AI-powered lead generation and outbound growth"


class EmailVariantOut(BaseModel):
    cold_email: str
    follow_ups: List[str]
    ab_tests: List[str]


class CampaignCreate(BaseModel):
    name: str
    schedule_at: Optional[datetime] = None
    follow_up_days: int = Field(default=3, ge=1, le=30)


class CampaignOut(BaseModel):
    id: UUID
    name: str
    status: str
    schedule_at: Optional[datetime]
    follow_up_days: int

    class Config:
        from_attributes = True


class DashboardMetrics(BaseModel):
    leads: int
    emails_sent: int
    open_rate: float
    replies: int
    conversions: int
    roi: float


class CheckoutRequest(BaseModel):
    plan: str
    success_url: HttpUrl
    cancel_url: HttpUrl
