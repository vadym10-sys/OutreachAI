from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Set, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


CustomerFinderStatus = Literal[
    "queued",
    "searching",
    "verifying",
    "enriching",
    "completed",
    "partially_completed",
    "failed",
]

VerifiedStatus = Literal["verified", "partially_verified", "unverified"]


class CustomerFinderCriteria(BaseModel):
    company_description: str = Field(min_length=3, max_length=2000)
    product_or_service: str = Field(min_length=3, max_length=2000)
    target_country: str = Field(min_length=2, max_length=120)
    target_industry: str = Field(min_length=2, max_length=160)
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
    fit_explanation: str
    ai_relevance_score: int
    confidence_score: int
    verified_status: VerifiedStatus
    checked_at: datetime
    source_provider: str
    dedupe_key: str
    signal_fingerprint: str
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
    fit_explanation: str = ""
    ai_relevance_score: int
    confidence_score: int
    verified_status: str
    checked_at: datetime
    source_provider: str
    lead_id: str = ""
    company_id: str = ""


class CustomerFinderJobOut(BaseModel):
    id: str
    status: str
    progress: Dict
    criteria: CustomerFinderCriteria
    error_message: str = ""
    results: List[CustomerFinderResultOut] = Field(default_factory=list)
    created_at: datetime
    completed_at: Optional[datetime] = None
