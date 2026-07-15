from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.reliability import retry_operation
from app.models.entities import (
    AuditLog,
    Campaign,
    CampaignSequence,
    CampaignStatus,
    EmailMessage,
    Lead,
    LeadStatus,
    Notification,
    NotificationKind,
    UsageCounter,
    Workspace,
    WebsiteAnalysis,
)
from app.schemas.dto import LeadFinderRequest, PersonalizeRequest
from app.services.ai import adaptive_follow_ups, personalize_email, sales_copilot
from app.services.emailer import send_email
from app.services.lead_finder import find_leads
from app.services.website import collect_website
from app.services.ai import analyze_company_website

logger = logging.getLogger("outreachai.acquisition")


def _fit_db_text(value: str | None, max_length: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 1].rstrip() + "…"


@dataclass
class WorkspaceAutomationResult:
    workspace_id: str
    campaign_id: str | None = None
    leads_imported: int = 0
    leads_qualified: int = 0
    emails_generated: int = 0
    emails_sent: int = 0
    follow_ups_sent: int = 0
    meetings_detected: int = 0
    crm_synced: int = 0
    blockers: list[str] = field(default_factory=list)


@dataclass
class AutomationRunResult:
    workspaces_processed: int = 0
    leads_imported: int = 0
    leads_qualified: int = 0
    emails_generated: int = 0
    emails_sent: int = 0
    follow_ups_sent: int = 0
    meetings_detected: int = 0
    crm_synced: int = 0
    blockers: list[str] = field(default_factory=list)
    workspaces: list[WorkspaceAutomationResult] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "workspaces_processed": self.workspaces_processed,
            "leads_imported": self.leads_imported,
            "leads_qualified": self.leads_qualified,
            "emails_generated": self.emails_generated,
            "emails_sent": self.emails_sent,
            "follow_ups_sent": self.follow_ups_sent,
            "meetings_detected": self.meetings_detected,
            "crm_synced": self.crm_synced,
            "blockers": self.blockers,
            "workspaces": [workspace.__dict__ for workspace in self.workspaces],
        }


def run_daily_acquisition(db: Session, *, workspace_id: str | UUID | None = None) -> AutomationRunResult:
    settings = get_settings()
    result = AutomationRunResult()
    if not settings.apollo_api_key and not settings.clay_api_key:
        result.blockers.append("APOLLO_API_KEY or CLAY_API_KEY is required for production autonomous lead discovery.")
    if not settings.openai_api_key:
        result.blockers.append("OPENAI_API_KEY is required for AI qualification and personalization.")
    if not settings.resend_api_key or not settings.resend_from_email:
        result.blockers.append("RESEND_API_KEY and RESEND_FROM_EMAIL are required for automatic outreach.")

    stmt = select(Workspace).order_by(Workspace.created_at.asc())
    if workspace_id:
        stmt = stmt.where(Workspace.id == (workspace_id if isinstance(workspace_id, UUID) else UUID(str(workspace_id))))
    workspaces = list(db.scalars(stmt).all())
    for workspace in workspaces:
        workspace_result = _run_workspace(db, workspace)
        result.workspaces.append(workspace_result)
        result.workspaces_processed += 1
        result.leads_imported += workspace_result.leads_imported
        result.leads_qualified += workspace_result.leads_qualified
        result.emails_generated += workspace_result.emails_generated
        result.emails_sent += workspace_result.emails_sent
        result.follow_ups_sent += workspace_result.follow_ups_sent
        result.meetings_detected += workspace_result.meetings_detected
        result.crm_synced += workspace_result.crm_synced
        result.blockers.extend(workspace_result.blockers)
    db.commit()
    return result


def _run_workspace(db: Session, workspace: Workspace) -> WorkspaceAutomationResult:
    workspace_result = WorkspaceAutomationResult(workspace_id=str(workspace.id))
    campaign = _ensure_automation_campaign(db, workspace)
    workspace_result.campaign_id = str(campaign.id)
    _audit(db, workspace.owner_user_id, workspace.id, "automation.run_started", {"campaign_id": str(campaign.id)})

    try:
        imported = _import_daily_leads(db, workspace, campaign)
        workspace_result.leads_imported = imported
    except Exception as exc:
        logger.exception("Autonomous lead import failed")
        workspace_result.blockers.append(f"lead_import: {exc}")

    candidates = list(
        db.scalars(
            select(Lead)
            .where(
                Lead.workspace_id == workspace.id,
                Lead.campaign_id == campaign.id,
                Lead.status.in_([LeadStatus.new, LeadStatus.qualified]),
            )
            .order_by(Lead.created_at.asc())
            .limit(get_settings().automation_batch_size)
        ).all()
    )
    for lead in candidates:
        try:
            if _qualify_lead(db, workspace, campaign, lead):
                workspace_result.leads_qualified += 1
            message = _generate_email_if_needed(db, workspace, campaign, lead)
            if message:
                workspace_result.emails_generated += 1
            if _send_ready_email(db, workspace, campaign, lead, message):
                workspace_result.emails_sent += 1
        except Exception as exc:
            logger.exception("Autonomous lead processing failed")
            workspace_result.blockers.append(f"{lead.company}: {exc}")

    try:
        workspace_result.follow_ups_sent = _send_due_follow_ups(db, workspace, campaign)
    except Exception as exc:
        logger.exception("Autonomous follow-up sending failed")
        workspace_result.blockers.append(f"follow_ups: {exc}")

    workspace_result.meetings_detected = _detect_meetings(db, workspace, campaign)
    workspace_result.crm_synced = _sync_crm(db, workspace, campaign)
    _audit(db, workspace.owner_user_id, workspace.id, "automation.run_finished", workspace_result.__dict__)
    _notify(
        db,
        workspace.owner_user_id,
        workspace.id,
        NotificationKind.info,
        "Autonomous acquisition completed",
        f"Imported {workspace_result.leads_imported}, sent {workspace_result.emails_sent}, follow-ups {workspace_result.follow_ups_sent}.",
    )
    return workspace_result


def _ensure_automation_campaign(db: Session, workspace: Workspace) -> Campaign:
    campaign = db.scalar(
        select(Campaign)
        .where(
            Campaign.workspace_id == workspace.id,
            Campaign.status.in_([CampaignStatus.running, CampaignStatus.scheduled]),
        )
        .order_by(Campaign.created_at.asc())
    )
    if campaign:
        return campaign
    campaign = Campaign(
        user_id=workspace.owner_user_id,
        workspace_id=workspace.id,
        name=f"Autonomous {workspace.industry or 'B2B'} Outreach",
        industry=workspace.industry or "B2B services",
        countries=[workspace.target_country] if workspace.target_country else [],
        cities=[],
        company_size="11-200",
        keywords=[workspace.target_customer] if workspace.target_customer else [],
        website_filters=["automation:working_hours=09:00-17:00", "automation:daily_send_limit=25"],
        language=workspace.language or "English",
        offer=f"help {workspace.target_customer or 'qualified buyers'} generate more pipeline",
        cta="Book a 15 minute call",
        email_tone="Consultative",
        signature=f"{workspace.company or workspace.name}",
        status=CampaignStatus.running,
        timezone=workspace.timezone or "UTC",
    )
    db.add(campaign)
    db.flush()
    for order, name, delay in [(1, "Email #1", 0), (2, "Follow-up #1", 3), (3, "Follow-up #2", 7), (4, "Follow-up #3", 12)]:
        db.add(CampaignSequence(campaign_id=campaign.id, step_order=order, name=name, subject="", body="", delay_days=delay))
    _audit(db, workspace.owner_user_id, workspace.id, "automation.campaign_created", {"campaign_id": str(campaign.id)})
    return campaign


def _import_daily_leads(db: Session, workspace: Workspace, campaign: Campaign) -> int:
    payload = LeadFinderRequest(
        niche=campaign.industry or workspace.industry or "B2B",
        industry=campaign.industry or workspace.industry or "B2B",
        country=(campaign.countries or [workspace.target_country or "United States"])[0],
        city=(campaign.cities or [""])[0],
        employee_count=campaign.company_size,
        revenue=None,
        technologies=[],
        keywords=[*(campaign.keywords or []), workspace.target_customer],
        limit=min(get_settings().automation_batch_size, 25),
    )
    found = find_leads(payload)
    imported = 0
    for item in found:
        duplicate_terms = []
        if item.email:
            duplicate_terms.append(Lead.email == str(item.email))
        if item.website:
            duplicate_terms.append(Lead.website == item.website)
        existing = db.scalar(select(Lead.id).where(Lead.workspace_id == workspace.id, or_(*duplicate_terms))) if duplicate_terms else None
        if existing:
            continue
        lead = Lead(
            user_id=workspace.owner_user_id,
            workspace_id=workspace.id,
            campaign_id=campaign.id,
            company=item.company,
            website=item.website,
            industry=item.industry or item.niche or campaign.industry,
            country=item.country,
            city=item.city,
            contact=item.contact,
            email=str(item.email) if item.email else None,
            phone=item.phone,
            linkedin=item.linkedin,
            niche=item.niche or campaign.industry,
            status=LeadStatus.new,
            notes=item.notes,
            revenue=item.revenue,
        )
        db.add(lead)
        db.flush()
        _analyze_website(db, workspace, lead)
        imported += 1
        _audit(db, workspace.owner_user_id, workspace.id, "automation.lead_imported", {"lead_id": str(lead.id), "company": lead.company})
    return imported


def _analyze_website(db: Session, workspace: Workspace, lead: Lead) -> None:
    if not lead.website:
        return
    try:
        snapshot = collect_website(lead.website)
        analysis = analyze_company_website(
            company=lead.company,
            website=snapshot.url,
            niche=lead.industry or lead.niche,
            page_title=snapshot.title,
            meta_description=snapshot.meta_description,
            page_text=snapshot.text,
            technologies=snapshot.technologies,
        )
    except Exception as exc:
        lead.notes = "\n".join(part for part in [lead.notes or "", f"Automation website analysis failed: {exc}"] if part)
        return
    db.add(
        WebsiteAnalysis(
            user_id=workspace.owner_user_id,
            workspace_id=workspace.id,
            lead_id=lead.id,
            company=_fit_db_text(analysis.company or lead.company, 220) or lead.company,
            website=_fit_db_text(analysis.website or lead.website, 500) or "",
            description=analysis.description,
            industry=_fit_db_text(analysis.industry, 160),
            location=_fit_db_text(analysis.location, 160),
            niche=_fit_db_text(analysis.niche, 120),
            products_services=analysis.products_services,
            services=analysis.services,
            technologies=analysis.technologies,
            strengths=analysis.strengths,
            weaknesses=analysis.weaknesses,
            summary=f"ICP score: {analysis.icp_score}/100. {analysis.summary}",
        )
    )
    lead.industry = lead.industry or _fit_db_text(analysis.industry, 160)
    lead.niche = lead.niche or _fit_db_text(analysis.niche, 120)
    lead.notes = "\n".join(part for part in [lead.notes or "", f"ICP score: {analysis.icp_score}/100", analysis.summary] if part)


def _qualify_lead(db: Session, workspace: Workspace, campaign: Campaign, lead: Lead) -> bool:
    if lead.status != LeadStatus.new:
        return False
    analysis = _latest_analysis(db, workspace, lead)
    messages = list(db.scalars(select(EmailMessage).where(EmailMessage.lead_id == lead.id).limit(10)).all())
    result = sales_copilot(
        {
            "lead": _lead_payload(lead),
            "website_analysis": _analysis_payload(analysis),
            "campaign": {"name": campaign.name, "industry": campaign.industry, "offer": campaign.offer, "cta": campaign.cta},
            "email_history": [{"status": message.delivery_status, "opened": bool(message.opened_at), "replied": bool(message.replied_at)} for message in messages],
        }
    )
    _usage(db, workspace, "ai_generations", 1)
    if not lead.revenue and result.estimated_revenue is not None:
        lead.revenue = result.estimated_revenue
    lead.notes = "\n".join(
        part
        for part in [
            lead.notes or "",
            f"Priority score: {result.probability_to_buy}/100 buy, {result.probability_to_reply}/100 reply. {result.best_first_contact}. {result.best_cta}",
        ]
        if part
    )
    lead.status = LeadStatus.qualified if result.probability_to_reply >= 35 or result.probability_to_buy >= 20 else LeadStatus.archive
    _audit(db, workspace.owner_user_id, workspace.id, "automation.lead_qualified", {"lead_id": str(lead.id), "status": lead.status.value})
    return lead.status == LeadStatus.qualified


def _generate_email_if_needed(db: Session, workspace: Workspace, campaign: Campaign, lead: Lead) -> EmailMessage | None:
    existing = db.scalar(select(EmailMessage).where(EmailMessage.lead_id == lead.id, EmailMessage.direction == "outbound").order_by(EmailMessage.created_at.asc()))
    if existing or lead.status != LeadStatus.qualified:
        return None
    analysis = _latest_analysis(db, workspace, lead)
    generated = personalize_email(
        PersonalizeRequest(
            company=lead.company,
            niche=lead.industry or campaign.industry or "B2B",
            website_summary=(analysis.summary if analysis else lead.notes) or lead.company,
            offer=campaign.offer or "a measurable outbound growth system",
            cta=campaign.cta,
            tone=campaign.email_tone,
            language=campaign.language,
            signature=campaign.signature,
        )
    )
    _usage(db, workspace, "ai_generations", 1)
    follow_ups = generated.follow_ups[:2]
    message = EmailMessage(
        user_id=workspace.owner_user_id,
        workspace_id=workspace.id,
        campaign_id=campaign.id,
        lead_id=lead.id,
        direction="outbound",
        subject=generated.subject,
        preview=generated.preview,
        body=generated.full_email,
        cta=generated.cta,
        follow_up_1=follow_ups[0] if len(follow_ups) > 0 else "",
        follow_up_2=follow_ups[1] if len(follow_ups) > 1 else "",
        delivery_status="draft",
        tags={"automation": True, "sequence_step": 1},
    )
    lead.status = LeadStatus.qualified
    db.add(message)
    _audit(db, workspace.owner_user_id, workspace.id, "automation.email_generated", {"lead_id": str(lead.id)})
    return message


def _send_ready_email(db: Session, workspace: Workspace, campaign: Campaign, lead: Lead, ready_message: EmailMessage | None = None) -> bool:
    if not lead.email or lead.status != LeadStatus.qualified:
        return False
    sent_today = db.scalar(
        select(func.count())
        .select_from(EmailMessage)
        .where(EmailMessage.campaign_id == campaign.id, EmailMessage.sent_at >= datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0))
    ) or 0
    if sent_today >= _daily_send_limit(campaign):
        return False
    message = ready_message or db.scalar(
        select(EmailMessage)
        .where(EmailMessage.lead_id == lead.id, EmailMessage.direction == "outbound", EmailMessage.delivery_status == "draft")
        .order_by(EmailMessage.created_at.asc())
    )
    if not message:
        return False
    response = send_email(to_email=lead.email, subject=message.subject, body=message.body)
    message.sent_at = datetime.utcnow()
    message.provider_message_id = str(response.get("id"))
    message.delivery_status = "sent"
    lead.status = LeadStatus.contacted
    _usage(db, workspace, "email_sends", 1)
    _audit(db, workspace.owner_user_id, workspace.id, "automation.email_sent", {"lead_id": str(lead.id), "email_id": str(message.id)})
    return True


def _send_due_follow_ups(db: Session, workspace: Workspace, campaign: Campaign) -> int:
    sent = 0
    sequence = list(db.scalars(select(CampaignSequence).where(CampaignSequence.campaign_id == campaign.id).order_by(CampaignSequence.step_order.asc())).all())
    steps = {step.step_order: step for step in sequence}
    originals = list(
        db.scalars(
            select(EmailMessage)
            .where(
                EmailMessage.campaign_id == campaign.id,
                EmailMessage.direction == "outbound",
                EmailMessage.sent_at.is_not(None),
                EmailMessage.tags["sequence_step"].as_integer() == 1,
            )
            .order_by(EmailMessage.sent_at.asc())
        ).all()
    )
    for original in originals:
        if sent >= get_settings().automation_send_limit_per_run:
            break
        lead = db.get(Lead, original.lead_id) if original.lead_id else None
        if not lead or not lead.email or lead.status in {LeadStatus.interested, LeadStatus.meeting, LeadStatus.won, LeadStatus.lost, LeadStatus.archive}:
            continue
        behavior = "opened" if original.opened_at else "no_open"
        dynamic = _adaptive_follow_up_body(db, workspace, campaign, lead, original, behavior)
        for step_order in [2, 3, 4]:
            if _follow_up_exists(db, original, step_order):
                continue
            step = steps.get(step_order)
            delay_days = step.delay_days if step else 3 * (step_order - 1)
            if not original.sent_at or original.sent_at > datetime.utcnow() - timedelta(days=delay_days):
                continue
            subject = (step.subject if step else "") or f"Re: {original.subject}"
            body = dynamic or (original.follow_up_1 if step_order == 2 else original.follow_up_2) or (step.body if step else "") or f"Hi, just following up on my note about {campaign.offer or 'your growth priorities'}."
            message = EmailMessage(
                user_id=workspace.owner_user_id,
                workspace_id=workspace.id,
                campaign_id=campaign.id,
                lead_id=lead.id,
                direction="outbound",
                subject=subject,
                body=body,
                preview=body[:160],
                delivery_status="draft",
                tags={"automation": True, "sequence_step": step_order, "parent_email_id": str(original.id), "behavior": behavior},
            )
            db.add(message)
            db.flush()
            response = send_email(to_email=lead.email, subject=message.subject, body=message.body)
            message.sent_at = datetime.utcnow()
            message.provider_message_id = str(response.get("id"))
            message.delivery_status = "sent"
            lead.status = LeadStatus.contacted
            _usage(db, workspace, "email_sends", 1)
            _audit(db, workspace.owner_user_id, workspace.id, "automation.follow_up_sent", {"lead_id": str(lead.id), "step": step_order})
            sent += 1
            break
    return sent


def _adaptive_follow_up_body(db: Session, workspace: Workspace, campaign: Campaign, lead: Lead, message: EmailMessage, behavior: str) -> str:
    try:
        result = adaptive_follow_ups(
            {
                "lead": _lead_payload(lead),
                "campaign": {"name": campaign.name, "offer": campaign.offer, "cta": campaign.cta},
                "last_email": {"subject": message.subject, "body": message.body, "opened": bool(message.opened_at), "clicked": bool(message.clicked_at), "replied": bool(message.replied_at)},
            }
        )
        _usage(db, workspace, "ai_generations", 1)
        return (getattr(result, behavior) or [""])[0]
    except Exception:
        logger.exception("Adaptive follow-up generation failed; using stored sequence body")
        return ""


def _detect_meetings(db: Session, workspace: Workspace, campaign: Campaign) -> int:
    messages = list(
        db.scalars(
            select(EmailMessage).where(
                EmailMessage.workspace_id == workspace.id,
                EmailMessage.campaign_id == campaign.id,
                EmailMessage.direction == "inbound",
                EmailMessage.replied_at.is_not(None),
            )
        ).all()
    )
    meetings = 0
    for message in messages:
        lead = db.get(Lead, message.lead_id) if message.lead_id else None
        if not lead or lead.status == LeadStatus.meeting:
            continue
        assistant = message.reply_assistant or {}
        next_step = str(assistant.get("next_step") or "").lower()
        score = int(assistant.get("qualification_score") or 0)
        if "meeting" in next_step or "call" in next_step or score >= 75:
            lead.status = LeadStatus.meeting
            meetings += 1
            _notify(db, workspace.owner_user_id, workspace.id, NotificationKind.success, "Meeting opportunity detected", f"{lead.company} is ready for a meeting.")
            _audit(db, workspace.owner_user_id, workspace.id, "automation.meeting_detected", {"lead_id": str(lead.id)})
    return meetings


def _sync_crm(db: Session, workspace: Workspace, campaign: Campaign) -> int:
    url = get_settings().crm_sync_webhook_url
    if not url:
        return 0
    leads = list(
        db.scalars(
            select(Lead)
            .where(Lead.workspace_id == workspace.id, Lead.campaign_id == campaign.id, Lead.updated_at >= datetime.utcnow() - timedelta(days=2))
            .order_by(Lead.updated_at.desc())
            .limit(50)
        ).all()
    )
    synced = 0
    with httpx.Client(timeout=15) as client:
        for lead in leads:
            payload = {"workspace_id": str(workspace.id), "campaign_id": str(campaign.id), "lead": _lead_payload(lead)}
            try:
                response = retry_operation(
                    lambda: client.post(url, json=payload),
                    attempts=3,
                    base_delay_seconds=0.4,
                    operation_name="automation.crm_sync",
                )
                response.raise_for_status()
                synced += 1
                _audit(db, workspace.owner_user_id, workspace.id, "automation.crm_synced", {"lead_id": str(lead.id)})
            except Exception as exc:
                logger.warning("CRM sync failed lead_id=%s campaign_id=%s reason=%s", lead.id, campaign.id, exc)
                _audit(
                    db,
                    workspace.owner_user_id,
                    workspace.id,
                    "automation.crm_sync_failed",
                    {"lead_id": str(lead.id), "campaign_id": str(campaign.id), "reason": str(exc)[:220]},
                )
    return synced


def _latest_analysis(db: Session, workspace: Workspace, lead: Lead) -> WebsiteAnalysis | None:
    return db.scalar(
        select(WebsiteAnalysis)
        .where(WebsiteAnalysis.workspace_id == workspace.id, WebsiteAnalysis.lead_id == lead.id)
        .order_by(WebsiteAnalysis.created_at.desc())
    )


def _analysis_payload(analysis: WebsiteAnalysis | None) -> dict[str, Any]:
    if not analysis:
        return {}
    return {
        "summary": analysis.summary,
        "services": analysis.services,
        "technologies": analysis.technologies,
        "strengths": analysis.strengths,
        "weaknesses": analysis.weaknesses,
    }


def _lead_payload(lead: Lead) -> dict[str, Any]:
    return {
        "id": str(lead.id),
        "company": lead.company,
        "website": lead.website,
        "industry": lead.industry,
        "country": lead.country,
        "city": lead.city,
        "contact": lead.contact,
        "email": lead.email,
        "status": lead.status.value if lead.status else "",
        "revenue": float(lead.revenue or 0),
        "notes": lead.notes,
    }


def _follow_up_exists(db: Session, original: EmailMessage, step_order: int) -> bool:
    return bool(
        db.scalar(
            select(EmailMessage.id).where(
                EmailMessage.tags["parent_email_id"].as_string() == str(original.id),
                EmailMessage.tags["sequence_step"].as_integer() == step_order,
            )
        )
    )


def _daily_send_limit(campaign: Campaign) -> int:
    for item in campaign.website_filters or []:
        marker = "automation:daily_send_limit="
        if isinstance(item, str) and item.startswith(marker):
            try:
                return int(item.removeprefix(marker))
            except ValueError:
                return 25
    return 25


def _usage(db: Session, workspace: Workspace, field: str, amount: int) -> None:
    period = datetime.utcnow().strftime("%Y-%m")
    usage = db.scalar(select(UsageCounter).where(UsageCounter.workspace_id == workspace.id, UsageCounter.period == period))
    if usage is None:
        usage = UsageCounter(workspace_id=workspace.id, period=period)
        db.add(usage)
        db.flush()
    setattr(usage, field, int(getattr(usage, field)) + amount)


def _audit(db: Session, user_id: str | None, workspace_id, action: str, metadata: dict[str, Any]) -> None:
    db.add(AuditLog(user_id=user_id, workspace_id=workspace_id, action=action, metadata_json=metadata))


def _notify(db: Session, user_id: str, workspace_id, kind: NotificationKind, title: str, message: str) -> None:
    db.add(Notification(user_id=user_id, workspace_id=workspace_id, kind=kind, title=title, message=message))
