from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Set, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator


CustomerFinderStatus = Literal[
    "queued",
    "searching",
    "verifying",
    "enriching",
    "completed",
    "partially_completed",
    "failed",
]

VerifiedStatus = Literal["verified", "partially_verified", "unknown", "rejected", "unverified"]


class CustomerFinderCriteria(BaseModel):
    company_website: str = Field(default="", max_length=500)
    desired_customers: str = Field(default="", max_length=2000)
    company_description: str = Field(default="", max_length=2000)
    product_or_service: str = Field(default="", max_length=2000)
    target_country: str = Field(default="Any", max_length=120)
    target_industry: str = Field(default="B2B", max_length=160)
    company_size: str = Field(default="", max_length=80)
    contact_titles: List[str] = Field(default_factory=list, max_length=8)
    max_results: int = Field(default=10, ge=1, le=25)
    additional_criteria: str = Field(default="", max_length=1500)
    keywords: List[str] = Field(default_factory=list, max_length=12)
    exclusions: List[str] = Field(default_factory=list, max_length=12)

    @field_validator("contact_titles", "keywords", "exclusions")
    @classmethod
    def clean_list(cls, values: List[str]) -> List[str]:
        seen: Set[str] = set()
        cleaned: List[str] = []
        for value in values:
            text = str(value or "").strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(text[:120])
        return cleaned

    @model_validator(mode="after")
    def normalize_simple_request(self) -> "CustomerFinderCriteria":
        if not self.company_description.strip() and self.company_website.strip():
            self.company_description = self.company_website.strip()
        if not self.product_or_service.strip() and self.desired_customers.strip():
            self.product_or_service = self.desired_customers.strip()
        if not self.desired_customers.strip() and self.product_or_service.strip():
            self.desired_customers = self.product_or_service.strip()
        if not self.company_website.strip() and self.company_description.strip().startswith(("http://", "https://")):
            self.company_website = self.company_description.strip()
        self.target_country = self.target_country.strip() or "Any"
        self.target_industry = self.target_industry.strip() or "B2B"
        if len(self.company_description.strip()) < 3:
            raise ValueError("Enter your company website.")
        if len(self.product_or_service.strip()) < 3:
            raise ValueError("Describe the customers you want to find.")
        return self


@dataclass(frozen=True)
class PublicCustomerCandidate:
    company_name: str
    website: str
    industry: str = ""
    country: str = ""
    source_provider: str = ""
    source_payload: Dict = field(default_factory=dict)


@dataclass(frozen=True)
class VerifiedCustomerSignal:
    company_name: str
    official_website: str
    domain: str
    industry: str
    country: str
    company_size: str
    contact_name: str
    contact_title: str
    public_work_contact: str
    signal_type: str
    signal_description: str
    signal_date: str
    source_url: str
    source_title: str
    source_type: str
    evidence_excerpt: str
    evidence_summary: str
    observed_fact: str
    model_inference: str
    fit_explanation: str
    ai_relevance_score: int
    confidence_score: int
    verified_status: VerifiedStatus
    checked_at: datetime
    source_provider: str
    dedupe_key: str
    signal_fingerprint: str
    canonical_source_url: str
    publication_date: str
    retrieved_at: datetime
    source_confidence: int
    source_verification_status: str
    first_line_opener: str
    draft_email: str
    metadata: Dict = field(default_factory=dict)


class AISignalClassification(BaseModel):
    signal_type: str = Field(max_length=80)
    signal_description: str = Field(max_length=700)
    evidence_summary: str = Field(max_length=900)
    fit_explanation: str = Field(max_length=900)
    relevance_score: int = Field(ge=0, le=100)
    confidence_score: int = Field(ge=0, le=100)
    verified_status: VerifiedStatus = "verified"


class CustomerFinderSourceOut(BaseModel):
    source_url: HttpUrl
    source_title: str = ""
    source_type: str = "official_website"
    publication_date: str = "Unknown"
    retrieved_at: datetime


class CustomerFinderResultOut(BaseModel):
    id: str
    company_name: str
    official_website: str = Field(min_length=1)
    industry: str = ""
    country: str = ""
    company_size: str = ""
    contact_name: str = ""
    contact_title: str = ""
    public_work_contact: str = ""
    signal_type: str
    signal_description: str
    signal_date: str = "Unknown"
    source_url: str = Field(min_length=1)
    source_title: str = ""
    source_type: str = "official_website"
    evidence_excerpt: str = ""
    evidence_summary: str = ""
    observed_fact: str = ""
    model_inference: str = ""
    fit_explanation: str = ""
    ai_relevance_score: int
    confidence_score: int
    verified_status: str
    checked_at: datetime
    source_provider: str
    canonical_source_url: str = ""
    publication_date: str = "Unknown"
    retrieved_at: Optional[datetime] = None
    source_confidence: int = 0
    source_verification_status: str = ""
    scoring_version: str = ""
    score_factors: Dict = Field(default_factory=dict)
    score_weights: Dict = Field(default_factory=dict)
    score_penalties: Dict = Field(default_factory=dict)
    score_explanation: str = ""
    icp_fit_score: int = 0
    buying_intent_score: int = 0
    revenue_opportunity_score: int = 0
    first_line_opener: str = ""
    draft_email: str = ""
    lead_id: str = ""
    company_id: str = ""
    score_delta: int = 0
    intent_alert: bool = False
    intent_timeline: List[Dict] = Field(default_factory=list)
    lead_status: str = ""
    simple_status: str = ""
    email_id: str = ""
    email_subject: str = ""
    email_body: str = ""
    email_delivery_status: str = ""
    can_send: bool = False


class CustomerFinderResultActionOut(BaseModel):
    status: str
    message: str
    result: CustomerFinderResultOut


class CustomerFinderJobOut(BaseModel):
    id: str
    status: str
    progress: Dict
    criteria: CustomerFinderCriteria
    summary: Dict = Field(default_factory=dict)
    error_message: str = ""
    results: List[CustomerFinderResultOut] = Field(default_factory=list)
    created_at: datetime
    completed_at: Optional[datetime] = None
