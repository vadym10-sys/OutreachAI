from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.entities import Company, EmailMessage, Lead, LeadStatus, Workspace
from app.services.agent_runtime.errors import ToolExecutionBlockedError
from app.services.agent_runtime.registry import ToolHandler, build_default_tool_registry
from app.services.agent_runtime.schemas import (
    GenerateEmailDraftInput,
    GenerateEmailDraftOutput,
    ResearchCompanyInput,
    ResearchCompanyOutput,
    SaveToCrmInput,
    SaveToCrmOutput,
    ScoreLeadInput,
    ScoreLeadOutput,
    SearchCompaniesInput,
    SearchCompaniesOutput,
    SendEmailOutput,
    SyncRepliesOutput,
    UnderstandBusinessInput,
    UnderstandBusinessOutput,
    VerifyEmailInput,
    VerifyEmailOutput,
)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass
class ToolExecutionContext:
    db: Session
    workspace: Workspace
    user_id: str
    request_id: str = ""


class AgentToolAdapters:
    def registry(self):
        return build_default_tool_registry(self.handlers())

    def handlers(self) -> dict[str, ToolHandler]:
        return {
            "understand_business": self.understand_business,
            "search_companies": self.search_companies,
            "research_company": self.research_company,
            "verify_email": self.verify_email,
            "score_lead": self.score_lead,
            "save_to_crm": self.save_to_crm,
            "generate_email_draft": self.generate_email_draft,
            "send_email": self.send_email,
            "sync_replies": self.sync_replies,
        }

    def understand_business(
        self, context: ToolExecutionContext, payload: UnderstandBusinessInput
    ) -> UnderstandBusinessOutput:
        workspace = context.workspace
        return UnderstandBusinessOutput(
            workspace_summary={
                "workspace_id": str(workspace.id),
                "name": workspace.name,
                "company": workspace.company,
                "industry": workspace.industry,
                "target_country": workspace.target_country,
                "target_customer": workspace.target_customer,
                "offer": workspace.offer,
                "cta": workspace.cta,
                "tone": workspace.tone,
                "language": workspace.language,
            },
            objective=payload.objective,
        )

    def search_companies(
        self, context: ToolExecutionContext, payload: SearchCompaniesInput
    ) -> SearchCompaniesOutput:
        return SearchCompaniesOutput(
            executed=False,
            results=[],
            reason=(
                "Customer Finder provider calls are not executed by AI Control Plane v1. "
                "Use the existing Customer Finder job path or a future approved adapter."
            ),
        )

    def research_company(
        self, context: ToolExecutionContext, payload: ResearchCompanyInput
    ) -> ResearchCompanyOutput:
        if payload.company_id:
            company = context.db.scalar(
                select(Company).where(
                    Company.id == payload.company_id,
                    Company.workspace_id == context.workspace.id,
                )
            )
            if company is None:
                return ResearchCompanyOutput(
                    executed=True,
                    company={},
                    facts=[],
                    reason="No workspace-scoped company record was found.",
                )
            facts = [
                item
                for item in [
                    f"Company: {company.name}",
                    f"Website: {company.website}" if company.website else "",
                    f"Industry: {company.industry}" if company.industry else "",
                    f"CRM stage: {company.crm_stage}" if company.crm_stage else "",
                    f"Email status: {company.email_status}" if company.email_status else "",
                ]
                if item
            ]
            return ResearchCompanyOutput(
                executed=True,
                company={
                    "id": str(company.id),
                    "name": company.name,
                    "website": company.website or "",
                    "domain": company.domain or "",
                    "industry": company.industry or "",
                    "crm_stage": company.crm_stage,
                    "email_status": company.email_status,
                },
                facts=facts,
            )
        return ResearchCompanyOutput(
            executed=False,
            company={"website": payload.website},
            facts=[],
            reason="External website research is registered but not executed by AI Control Plane v1.",
        )

    def verify_email(
        self, context: ToolExecutionContext, payload: VerifyEmailInput
    ) -> VerifyEmailOutput:
        clean_email = payload.email.strip().lower()
        if EMAIL_RE.match(clean_email):
            return VerifyEmailOutput(
                executed=True,
                status="format_valid",
                confidence=40,
                reason="Local syntax check only; no Hunter/Gmail/provider verification was called.",
            )
        return VerifyEmailOutput(
            executed=True,
            status="invalid_format",
            confidence=0,
            reason="Email failed local syntax validation.",
        )

    def score_lead(
        self, context: ToolExecutionContext, payload: ScoreLeadInput
    ) -> ScoreLeadOutput:
        reasons = []
        score = 20
        if payload.contact_verified:
            score += 25
            reasons.append("Verified contact is present.")
        for signal in payload.signals[:12]:
            clean = str(signal or "").strip()
            if not clean:
                continue
            score += 8
            reasons.append(clean[:160])
        if payload.company_name:
            score += 5
        return ScoreLeadOutput(score=max(0, min(100, score)), reasons=reasons[:8])

    def save_to_crm(
        self, context: ToolExecutionContext, payload: SaveToCrmInput
    ) -> SaveToCrmOutput:
        if payload.dry_run:
            return SaveToCrmOutput(status="dry_run", dry_run=True)
        clean_name = payload.company_name.strip()
        clean_website = payload.website.strip()
        clean_email = payload.contact_email.strip().lower()
        existing = context.db.scalar(
            select(Company)
            .where(
                Company.workspace_id == context.workspace.id,
                or_(
                    Company.name == clean_name,
                    Company.website == clean_website if clean_website else False,
                    Company.email == clean_email if clean_email else False,
                ),
            )
            .order_by(Company.updated_at.desc())
        )
        if existing is not None:
            lead = (
                context.db.scalar(
                    select(Lead).where(
                        Lead.id == existing.lead_id,
                        Lead.workspace_id == context.workspace.id,
                    )
                )
                if existing.lead_id
                else None
            )
            return SaveToCrmOutput(
                status="already_exists",
                dry_run=False,
                company_id=existing.id,
                lead_id=lead.id if lead else None,
            )

        lead = Lead(
            user_id=context.user_id,
            workspace_id=context.workspace.id,
            company=clean_name,
            website=clean_website or None,
            email=clean_email or None,
            notes=payload.notes.strip() or None,
            status=LeadStatus.new,
        )
        context.db.add(lead)
        context.db.flush()
        company = Company(
            user_id=context.user_id,
            workspace_id=context.workspace.id,
            lead_id=lead.id,
            name=clean_name,
            website=clean_website or None,
            email=clean_email or None,
            source="agent_runtime",
            crm_stage="New Lead",
            email_status="Found" if clean_email else "Unknown",
            metadata_json={
                "source": "agent_runtime",
                "request_id": context.request_id,
                "untrusted_input": True,
            },
        )
        context.db.add(company)
        context.db.flush()
        return SaveToCrmOutput(
            status="created",
            dry_run=False,
            company_id=company.id,
            lead_id=lead.id,
        )

    def generate_email_draft(
        self, context: ToolExecutionContext, payload: GenerateEmailDraftInput
    ) -> GenerateEmailDraftOutput:
        if payload.dry_run:
            return GenerateEmailDraftOutput(status="dry_run", email_id=None)
        lead = None
        if payload.lead_id:
            lead = context.db.scalar(
                select(Lead).where(
                    Lead.id == payload.lead_id,
                    Lead.workspace_id == context.workspace.id,
                )
            )
        if lead is None and payload.company_id:
            company = context.db.scalar(
                select(Company).where(
                    Company.id == payload.company_id,
                    Company.workspace_id == context.workspace.id,
                )
            )
            if company and company.lead_id:
                lead = context.db.scalar(
                    select(Lead).where(
                        Lead.id == company.lead_id,
                        Lead.workspace_id == context.workspace.id,
                    )
                )
        recipient_email = payload.recipient_email.strip().lower() or (
            str(lead.email).strip().lower() if lead and lead.email else ""
        )
        email = EmailMessage(
            user_id=context.user_id,
            workspace_id=context.workspace.id,
            lead_id=lead.id if lead else None,
            recipient_email=recipient_email or None,
            subject=payload.subject.strip(),
            preview=payload.body.strip()[:500],
            body=payload.body.strip(),
            tags={
                "source": "agent_runtime",
                "requires_approval": True,
                "draft_only": True,
                "generated_at": datetime.utcnow().isoformat(),
                "untrusted_input": True,
            },
            delivery_status="draft",
        )
        context.db.add(email)
        context.db.flush()
        return GenerateEmailDraftOutput(
            status="draft_created",
            email_id=email.id,
            delivery_status=email.delivery_status,
        )

    def send_email(self, context: ToolExecutionContext, payload) -> SendEmailOutput:
        raise ToolExecutionBlockedError(
            "send_email is registered but external sending is disabled in AI Control Plane v1."
        )

    def sync_replies(self, context: ToolExecutionContext, payload) -> SyncRepliesOutput:
        raise ToolExecutionBlockedError(
            "sync_replies is registered but Gmail/reply synchronization is disabled in AI Control Plane v1."
        )


def default_tool_registry():
    return AgentToolAdapters().registry()
