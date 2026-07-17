from __future__ import annotations

import json
import logging
import socket
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.models.entities import (
    AICustomerFinderJob,
    AICustomerFinderResult,
    AICustomerFinderSource,
    AuditLog,
    Company,
    Lead,
    Notification,
    NotificationKind,
)
from app.schemas.dto import LeadOut
from app.services.ai_customer_finder.dedupe import canonical_url, company_dedupe_key, content_hash, normalized_domain, signal_fingerprint
from app.services.ai_customer_finder.providers import GoogleMapsConfigurationError, GoogleMapsRequestError, provider_for_key
from app.services.ai_customer_finder.schemas import CustomerFinderCriteria, CustomerFinderJobOut, CustomerFinderResultOut, PublicCustomerCandidate, VerifiedCustomerSignal
from app.services.ai_customer_finder.scoring import meaningful_signal_present, score_candidate, signal_type_from_text
from app.services.website import WebsiteFetchError, collect_website, normalize_website_url

logger = logging.getLogger("outreachai.ai_customer_finder")

ACTIVE_STATUSES = {"queued", "searching", "verifying", "enriching"}
TERMINAL_STATUSES = {"completed", "partially_completed", "failed"}
MAX_RETRY_BACKOFF_SECONDS = 3600


def enqueue_ai_customer_finder_job(
    db: Session,
    *,
    user_id: str,
    workspace_id: UUID,
    criteria: CustomerFinderCriteria,
    request_id: str,
) -> AICustomerFinderJob:
    settings = get_settings()
    max_results = max(1, min(criteria.max_results, int(settings.ai_customer_finder_max_results_per_job or 10)))
    clean_criteria = criteria.model_copy(update={"max_results": max_results})
    job = AICustomerFinderJob(
        user_id=user_id,
        workspace_id=workspace_id,
        status="queued",
        max_attempts=max(1, min(5, int(settings.enrichment_max_retries or 2) + 1)),
        request_id=request_id,
        criteria_json=clean_criteria.model_dump(),
        progress_json={"stage": "queued", "message": "AI Customer Finder is queued.", "percent": 5},
        run_after=datetime.utcnow(),
    )
    db.add(job)
    db.add(
        AuditLog(
            user_id=user_id,
            workspace_id=workspace_id,
            action="ai_customer_finder.queued",
            metadata_json={"request_id": request_id, "target_country": clean_criteria.target_country, "target_industry": clean_criteria.target_industry},
        )
    )
    return job


def claim_next_ai_customer_finder_job(db: Session, *, worker_id: str | None = None, stale_after_seconds: int = 900) -> AICustomerFinderJob | None:
    now = datetime.utcnow()
    stale_before = now - timedelta(seconds=stale_after_seconds)
    stmt = (
        select(AICustomerFinderJob)
        .where(
            AICustomerFinderJob.cancel_requested.is_(False),
            or_(
                AICustomerFinderJob.status == "queued",
                (AICustomerFinderJob.status.in_(("searching", "verifying", "enriching"))) & (AICustomerFinderJob.locked_at.is_not(None)) & (AICustomerFinderJob.locked_at < stale_before),
            ),
            AICustomerFinderJob.run_after <= now,
        )
        .order_by(AICustomerFinderJob.priority.desc(), AICustomerFinderJob.run_after.asc(), AICustomerFinderJob.created_at.asc())
        .limit(1)
    )
    if db.bind and db.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    job = db.scalar(stmt)
    if not job:
        return None
    claim = worker_id or f"{socket.gethostname()}:ai-customer-finder"
    job.status = "searching"
    job.locked_by = claim
    job.locked_at = now
    job.started_at = job.started_at or now
    job.attempts = int(job.attempts or 0) + 1
    job.progress_json = {"stage": "searching", "message": "Searching approved public sources.", "percent": 15}
    job.updated_at = now
    db.commit()
    db.refresh(job)
    return job


def heartbeat_ai_customer_finder_job(db: Session, *, job_id: UUID, claim_token: str) -> bool:
    job = db.get(AICustomerFinderJob, job_id)
    if not job or job.locked_by != claim_token:
        return False
    job.locked_at = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    db.commit()
    return True


def process_ai_customer_finder_job(job_id: UUID, *, claim_token: str | None = None) -> bool:
    db = get_sessionmaker()()
    try:
        job = db.get(AICustomerFinderJob, job_id)
        if job is None:
            return False
        if claim_token and job.locked_by != claim_token:
            return False
        criteria = CustomerFinderCriteria.model_validate(job.criteria_json or {})
        _set_progress(db, job, "searching", "Searching approved public sources.", 20, claim_token=claim_token)
        settings = get_settings()
        provider = provider_for_key(settings.ai_customer_finder_provider)
        candidates = provider.search(criteria, max_candidates=max(criteria.max_results, int(settings.ai_customer_finder_max_candidates_per_job or 25)))
        if job.cancel_requested:
            _mark_cancelled(db, job, "AI Customer Finder was stopped.", claim_token=claim_token)
            return True
        _set_progress(db, job, "verifying", "Verifying source URLs and evidence.", 40, claim_token=claim_token)
        warnings: list[str] = []
        quality_counts = {"verified": 0, "partially_verified": 0, "unknown": 0, "rejected": 0}
        saved = 0
        seen_companies: set[str] = set()
        for index, candidate in enumerate(candidates):
            if saved >= criteria.max_results:
                break
            db.refresh(job)
            if job.cancel_requested:
                _mark_cancelled(db, job, "AI Customer Finder was stopped.", claim_token=claim_token)
                return True
            dedupe = company_dedupe_key(website=candidate.website, company_name=candidate.company_name, country=candidate.country or criteria.target_country)
            if dedupe in seen_companies:
                quality_counts["rejected"] += 1
                warnings.append(f"{candidate.company_name}: Duplicate candidate skipped.")
                continue
            seen_companies.add(dedupe)
            try:
                signal = _verify_candidate(criteria, candidate)
            except (WebsiteFetchError, ValueError) as exc:
                reason = str(exc)[:180]
                if isinstance(exc, WebsiteFetchError):
                    quality_counts["unknown"] += 1
                else:
                    quality_counts["rejected"] += 1
                warnings.append(f"{candidate.company_name}: {reason}")
                _set_progress(
                    db,
                    job,
                    "verifying",
                    f"Rejected weak or unverified source for {candidate.company_name}.",
                    min(85, 45 + index * 5),
                    claim_token=claim_token,
                    summary={"candidates": len(candidates), "saved": saved, **quality_counts, "warnings": warnings[:10]},
                )
                continue
            _set_progress(db, job, "enriching", f"Saving verified result for {signal.company_name}.", min(85, 45 + index * 5), claim_token=claim_token)
            result = _persist_signal(db, job, signal)
            _save_signal_to_crm(db, job, result, criteria)
            quality_counts[signal.verified_status] = quality_counts.get(signal.verified_status, 0) + 1
            saved += 1
            db.commit()
        final_status = "completed" if saved > 0 and not warnings else ("partially_completed" if saved > 0 else "failed")
        message = "AI Customer Finder completed." if final_status == "completed" else ("AI Customer Finder saved partial verified results." if saved else "No verified public-source results were found.")
        job.status = final_status
        job.summary_json = {"saved": saved, "candidates": len(candidates), **quality_counts, "warnings": warnings[:10]}
        job.progress_json = {"stage": final_status, "message": message, "percent": 100, "warnings": warnings[:10], **quality_counts, "saved": saved, "candidates": len(candidates)}
        job.error_message = "" if saved else "; ".join(warnings[:3]) or "No verified public-source results were found."
        job.locked_by = ""
        job.locked_at = None
        job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        db.add(AuditLog(user_id=job.user_id, workspace_id=job.workspace_id, action="ai_customer_finder.completed", metadata_json={"job_id": str(job.id), "status": final_status, "saved": saved}))
        db.commit()
        return True
    except Exception as exc:
        db.rollback()
        retry_db = get_sessionmaker()()
        try:
            retry_job = retry_db.get(AICustomerFinderJob, job_id)
            if retry_job is not None:
                fail_or_retry_ai_customer_finder_job(retry_db, retry_job, exc, claim_token=claim_token)
        finally:
            retry_db.close()
        logger.warning("AI Customer Finder job failed job_id=%s reason=%s", job_id, str(exc)[:300])
        return True
    finally:
        db.close()


def fail_or_retry_ai_customer_finder_job(db: Session, job: AICustomerFinderJob, exc: Exception, *, claim_token: str | None = None, retry_delay_seconds: int = 60) -> bool:
    if claim_token and job.locked_by != claim_token:
        return False
    now = datetime.utcnow()
    attempts = int(job.attempts or 0)
    max_attempts = max(1, int(job.max_attempts or 1))
    job.error_message = str(exc)[:2000]
    job.locked_by = ""
    job.locked_at = None
    if attempts < max_attempts and not job.cancel_requested:
        retry_delay = min(MAX_RETRY_BACKOFF_SECONDS, retry_delay_seconds * (2 ** max(0, attempts - 1)))
        job.status = "queued"
        job.run_after = now + timedelta(seconds=retry_delay)
        job.progress_json = {"stage": "queued", "message": "Temporary issue. AI Customer Finder will retry.", "percent": 20, "attempts": attempts, "max_attempts": max_attempts}
    else:
        job.status = "failed"
        job.completed_at = now
        job.progress_json = {"stage": "failed", "message": "AI Customer Finder could not finish.", "percent": 100, "attempts": attempts, "max_attempts": max_attempts}
    job.updated_at = now
    db.commit()
    return True


def cancel_ai_customer_finder_job(db: Session, *, workspace_id: UUID, job_id: UUID) -> AICustomerFinderJob:
    job = _scoped_job(db, workspace_id=workspace_id, job_id=job_id)
    job.cancel_requested = True
    if job.status == "queued":
        job.status = "failed"
        job.error_message = "Cancelled before processing."
        job.completed_at = datetime.utcnow()
    job.progress_json = {**(job.progress_json or {}), "message": "Cancellation requested."}
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


def job_out(db: Session, job: AICustomerFinderJob) -> CustomerFinderJobOut:
    results = list(
        db.scalars(
            select(AICustomerFinderResult)
            .where(AICustomerFinderResult.workspace_id == job.workspace_id, AICustomerFinderResult.job_id == job.id)
            .order_by(AICustomerFinderResult.ai_relevance_score.desc(), AICustomerFinderResult.created_at.asc())
        ).all()
    )
    return CustomerFinderJobOut(
        id=str(job.id),
        status=job.status,
        progress=job.progress_json if isinstance(job.progress_json, dict) else {},
        criteria=CustomerFinderCriteria.model_validate(job.criteria_json or {}),
        summary=job.summary_json if isinstance(job.summary_json, dict) else {},
        error_message=job.error_message or "",
        results=[result_out(item) for item in results],
        created_at=job.created_at,
        completed_at=job.completed_at,
    )


def result_out(result: AICustomerFinderResult) -> CustomerFinderResultOut:
    metadata = result.metadata_json if isinstance(result.metadata_json, dict) else {}
    source_verification = metadata.get("source_verification") if isinstance(metadata.get("source_verification"), dict) else {}
    scoring = metadata.get("scoring") if isinstance(metadata.get("scoring"), dict) else {}
    outreach = metadata.get("outreach_draft") if isinstance(metadata.get("outreach_draft"), dict) else {}
    return CustomerFinderResultOut(
        id=str(result.id),
        company_name=result.company_name,
        official_website=result.official_website,
        industry=result.industry,
        country=result.country,
        company_size=result.company_size,
        contact_name=result.contact_name,
        contact_title=result.contact_title,
        public_work_contact=result.public_work_contact,
        signal_type=result.signal_type,
        signal_description=result.signal_description,
        signal_date=result.signal_date,
        source_url=result.source_url,
        source_title=result.source_title,
        source_type=result.source_type,
        evidence_excerpt=result.evidence_excerpt,
        evidence_summary=result.evidence_summary,
        observed_fact=str(source_verification.get("observed_fact") or metadata.get("observed_fact") or ""),
        model_inference=str(source_verification.get("model_inference") or metadata.get("model_inference") or ""),
        fit_explanation=result.fit_explanation,
        ai_relevance_score=result.ai_relevance_score,
        confidence_score=result.confidence_score,
        verified_status=result.verified_status,
        checked_at=result.checked_at,
        source_provider=result.source_provider,
        canonical_source_url=str(source_verification.get("canonical_url") or metadata.get("canonical_source_url") or canonical_url(result.source_url)),
        publication_date=str(source_verification.get("publication_date") or metadata.get("publication_date") or "Unknown"),
        retrieved_at=source_verification.get("retrieved_at") or result.checked_at,
        source_confidence=_safe_int(source_verification.get("confidence"), result.confidence_score),
        source_verification_status=str(source_verification.get("status") or result.verified_status),
        scoring_version=str(scoring.get("version") or metadata.get("scoring_version") or ""),
        score_factors=scoring.get("factors") if isinstance(scoring.get("factors"), dict) else {},
        score_weights=scoring.get("weights") if isinstance(scoring.get("weights"), dict) else {},
        score_penalties=scoring.get("penalties") if isinstance(scoring.get("penalties"), dict) else {},
        score_explanation=str(scoring.get("explanation") or result.fit_explanation or ""),
        icp_fit_score=_safe_int(scoring.get("icp_fit_score"), 0),
        buying_intent_score=_safe_int(scoring.get("buying_intent_score"), result.ai_relevance_score),
        revenue_opportunity_score=_safe_int(scoring.get("revenue_opportunity_score"), 0),
        first_line_opener=str(outreach.get("first_line_opener") or ""),
        draft_email=str(outreach.get("draft_email") or ""),
        lead_id=str(result.lead_id or ""),
        company_id=str(result.company_id or ""),
        score_delta=_safe_int((result.metadata_json or {}).get("score_delta"), 0),
        intent_alert=bool((result.metadata_json or {}).get("intent_alert")),
        intent_timeline=[item for item in (result.metadata_json or {}).get("intent_timeline", []) if isinstance(item, dict)] if isinstance((result.metadata_json or {}).get("intent_timeline"), list) else [],
    )


def _verify_candidate(criteria: CustomerFinderCriteria, candidate: PublicCustomerCandidate) -> VerifiedCustomerSignal:
    website = normalize_website_url(candidate.website)
    snapshot = collect_website(website)
    text = snapshot.text or snapshot.meta_description or snapshot.title
    if not text.strip():
        raise WebsiteFetchError("Public source had no readable evidence.")
    signal_type = signal_type_from_text(text)
    if signal_type == "public_company_fit" or not meaningful_signal_present(text):
        raise ValueError("Rejected: public source confirms ICP fit but no meaningful buying or timing signal.")
    score = score_candidate(criteria, text=text, industry=candidate.industry, country=candidate.country, source_verified=True, source_type="official_website", publication_date="Unknown")
    excerpt = _evidence_excerpt(text, criteria)
    source_url = canonical_url(snapshot.url or website)
    if not source_url or not normalized_domain(source_url):
        raise ValueError("Rejected: source URL could not be canonicalized.")
    fingerprint = signal_fingerprint(source_url=source_url, signal_type=signal_type, evidence=excerpt, company_name=candidate.company_name)
    domain = normalized_domain(source_url)
    signal_description = _signal_description(signal_type, candidate.company_name, criteria)
    observed_fact = _observed_fact(signal_type, excerpt, candidate.company_name)
    model_inference = _model_inference(signal_type, criteria)
    first_line = _first_line_opener(candidate.company_name, observed_fact)
    draft_email = _draft_email(criteria, candidate.company_name, first_line, model_inference)
    verified_status = "verified" if score.confidence_score >= 60 and score.buying_intent_score >= 60 else "partially_verified"
    return VerifiedCustomerSignal(
        company_name=candidate.company_name,
        official_website=source_url,
        domain=domain,
        industry=candidate.industry or criteria.target_industry,
        country=candidate.country or criteria.target_country,
        company_size="",
        contact_name="",
        contact_title=", ".join(criteria.contact_titles[:2]),
        public_work_contact="",
        signal_type=signal_type,
        signal_description=signal_description,
        signal_date="Unknown",
        source_url=source_url,
        source_title=snapshot.title or candidate.company_name,
        source_type="official_website",
        evidence_excerpt=excerpt,
        evidence_summary=f"Verified public website content contains a {signal_type.replace('_', ' ')} signal relevant to {criteria.target_industry}.",
        observed_fact=observed_fact,
        model_inference=model_inference,
        fit_explanation=score.explanation,
        ai_relevance_score=score.relevance_score,
        confidence_score=score.confidence_score,
        verified_status=verified_status,
        checked_at=datetime.utcnow(),
        source_provider=candidate.source_provider,
        dedupe_key=company_dedupe_key(website=source_url, company_name=candidate.company_name, country=candidate.country or criteria.target_country),
        signal_fingerprint=fingerprint,
        canonical_source_url=source_url,
        publication_date="Unknown",
        retrieved_at=datetime.utcnow(),
        source_confidence=score.source_quality_score,
        source_verification_status=verified_status,
        first_line_opener=first_line,
        draft_email=draft_email,
        metadata={
            "score_factors": score.factors,
            "provider_payload": candidate.source_payload,
            "publication_date_status": "Unknown",
            "observed_fact": observed_fact,
            "model_inference": model_inference,
            "canonical_source_url": source_url,
            "publication_date": "Unknown",
            "retrieved_at": datetime.utcnow().isoformat(),
            "source_verification": {
                "source_url": source_url,
                "canonical_url": source_url,
                "source_title": snapshot.title or candidate.company_name,
                "source_type": "official_website",
                "publication_date": "Unknown",
                "retrieved_at": datetime.utcnow().isoformat(),
                "evidence_summary": f"Verified public website content contains a {signal_type.replace('_', ' ')} signal relevant to {criteria.target_industry}.",
                "observed_fact": observed_fact,
                "model_inference": model_inference,
                "confidence": score.source_quality_score,
                "status": verified_status,
            },
            "scoring": {
                "version": score.scoring_version,
                "icp_fit_score": score.icp_fit_score,
                "buying_intent_score": score.buying_intent_score,
                "revenue_opportunity_score": score.revenue_opportunity_score,
                "factors": score.factors,
                "weights": score.weights,
                "penalties": score.penalties,
                "explanation": score.explanation,
                "previous_score": None,
                "final_score": score.buying_intent_score,
            },
            "outreach_draft": {
                "first_line_opener": first_line,
                "draft_email": draft_email,
                "draft_only": True,
                "requires_review": True,
            },
        },
    )


def _persist_signal(db: Session, job: AICustomerFinderJob, signal: VerifiedCustomerSignal) -> AICustomerFinderResult:
    existing = db.scalar(
        select(AICustomerFinderResult).where(
            AICustomerFinderResult.workspace_id == job.workspace_id,
            AICustomerFinderResult.job_id == job.id,
            AICustomerFinderResult.signal_fingerprint == signal.signal_fingerprint,
        )
    )
    if existing:
        return existing
    result = AICustomerFinderResult(
        workspace_id=job.workspace_id,
        user_id=job.user_id,
        job_id=job.id,
        company_name=signal.company_name,
        official_website=signal.official_website,
        domain=signal.domain,
        industry=signal.industry,
        country=signal.country,
        company_size=signal.company_size,
        contact_name=signal.contact_name,
        contact_title=signal.contact_title,
        public_work_contact=signal.public_work_contact,
        signal_type=signal.signal_type,
        signal_description=signal.signal_description,
        signal_date=signal.signal_date,
        source_url=signal.source_url,
        source_title=signal.source_title,
        source_type=signal.source_type,
        evidence_excerpt=signal.evidence_excerpt,
        evidence_summary=signal.evidence_summary,
        fit_explanation=signal.fit_explanation,
        ai_relevance_score=signal.ai_relevance_score,
        confidence_score=signal.confidence_score,
        verified_status=signal.verified_status,
        checked_at=signal.checked_at,
        source_provider=signal.source_provider,
        dedupe_key=signal.dedupe_key,
        signal_fingerprint=signal.signal_fingerprint,
        metadata_json=signal.metadata,
    )
    db.add(result)
    db.flush()
    db.add(
        AICustomerFinderSource(
            workspace_id=job.workspace_id,
            user_id=job.user_id,
            job_id=job.id,
            result_id=result.id,
            source_url=signal.source_url,
            canonical_url=canonical_url(signal.source_url),
            source_title=signal.source_title,
            source_type=signal.source_type,
            publication_date=signal.signal_date or "Unknown",
            retrieved_at=signal.checked_at,
            content_hash=content_hash(signal.evidence_excerpt or signal.evidence_summary),
            metadata_json={
                "verified_status": signal.verified_status,
                "observed_fact": signal.observed_fact,
                "model_inference": signal.model_inference,
                "source_confidence": signal.source_confidence,
            },
        )
    )
    return result


def _save_signal_to_crm(db: Session, job: AICustomerFinderJob, result: AICustomerFinderResult, criteria: CustomerFinderCriteria) -> None:
    from app.api.routes import _existing_duplicate_lead, _merge_lead_metadata, _sync_lead_to_crm

    metadata = {
        "source": "ai_customer_finder",
        "ai_customer_finder": {
            "job_id": str(job.id),
            "result_id": str(result.id),
            "signal_type": result.signal_type,
            "signal_description": result.signal_description,
            "signal_date": result.signal_date,
            "source_url": result.source_url,
            "source_title": result.source_title,
            "source_type": result.source_type,
            "evidence_summary": result.evidence_summary,
            "evidence_excerpt": result.evidence_excerpt,
            "observed_fact": (result.metadata_json or {}).get("observed_fact"),
            "model_inference": (result.metadata_json or {}).get("model_inference"),
            "source_verification": (result.metadata_json or {}).get("source_verification"),
            "scoring": (result.metadata_json or {}).get("scoring"),
            "outreach_draft": (result.metadata_json or {}).get("outreach_draft"),
            "fit_explanation": result.fit_explanation,
            "ai_relevance_score": result.ai_relevance_score,
            "confidence_score": result.confidence_score,
            "verified_status": result.verified_status,
            "checked_at": result.checked_at.isoformat(),
        },
        "buying_signals": [result.signal_description],
        "buying_signal_score": result.ai_relevance_score,
        "buying_signal_confidence": result.confidence_score,
        "buying_signal_evidence": [{"source_url": result.source_url, "value": result.evidence_summary, "source_field": "ai_customer_finder.source"}],
        "recommended_decision_maker_role": result.contact_title or ", ".join(criteria.contact_titles[:2]),
        "priority_score": result.ai_relevance_score,
        "confidence_score": result.confidence_score,
    }
    lead_out = LeadOut(
        company=result.company_name,
        website=result.official_website,
        industry=result.industry,
        country=result.country,
        contact=result.contact_name or None,
        email=result.public_work_contact or None,
        source="ai_customer_finder",
        domain=result.domain or None,
        notes=json.dumps(metadata),
    )
    existing = _existing_duplicate_lead(db, job.workspace, job.user_id, lead_out)
    if existing:
        existing.notes = _merge_lead_metadata(existing, metadata)
        company = _sync_lead_to_crm(db, job.user_id, job.workspace, existing)
        _record_intent_score_movement(db, job, company, result)
        result.lead_id = existing.id
        result.company_id = company.id
        result.updated_at = datetime.utcnow()
        return
    lead = Lead(
        user_id=job.user_id,
        workspace_id=job.workspace_id,
        company=result.company_name,
        website=result.official_website,
        industry=result.industry,
        country=result.country,
        contact=result.contact_name or None,
        email=result.public_work_contact or None,
        notes=json.dumps(metadata),
    )
    db.add(lead)
    db.flush()
    company = _sync_lead_to_crm(db, job.user_id, job.workspace, lead)
    company.source = "ai_customer_finder"
    company.metadata_json = {**(company.metadata_json or {}), **metadata}
    company.crm_stage = "Qualified"
    company.email_status = "Not prepared"
    company.updated_at = datetime.utcnow()
    _record_intent_score_movement(db, job, company, result)
    result.lead_id = lead.id
    result.company_id = company.id
    result.updated_at = datetime.utcnow()


def _record_intent_score_movement(db: Session, job: AICustomerFinderJob, company: Company, result: AICustomerFinderResult) -> None:
    metadata = company.metadata_json if isinstance(company.metadata_json, dict) else {}
    live = metadata.get("ai_live_buying_signals") if isinstance(metadata.get("ai_live_buying_signals"), dict) else {}
    previous_score = _score_or_none(live.get("current_score"))
    current_score = _safe_int(result.ai_relevance_score, 0)
    score_delta = current_score - previous_score if previous_score is not None else 0
    timeline = [item for item in live.get("change_timeline", []) if isinstance(item, dict)] if isinstance(live.get("change_timeline"), list) else []
    existing_fingerprints = {str(item.get("signal_fingerprint") or "") for item in timeline if isinstance(item, dict)}
    is_new_event = result.signal_fingerprint not in existing_fingerprints
    event = {
        "change_type": _change_type_for_signal(result.signal_type),
        "detected_at": result.checked_at.isoformat(),
        "company": result.company_name,
        "signal": result.signal_description,
        "source_url": result.source_url,
        "source_title": result.source_title,
        "previous_score": previous_score,
        "current_score": current_score,
        "score_delta": score_delta,
        "confidence": result.confidence_score,
        "signal_fingerprint": result.signal_fingerprint,
    }
    if is_new_event:
        timeline = [*timeline, event][-20:]
    latest_changes = [event] if is_new_event else []
    intent_alert = bool(is_new_event and result.verified_status in {"verified", "partially_verified"} and ((previous_score is not None and ((current_score >= 80 and score_delta >= 8) or score_delta >= 15)) or (previous_score is None and current_score >= 85 and result.confidence_score >= 70)))
    merged_signals = _dedupe_strings([*(metadata.get("buying_signals") if isinstance(metadata.get("buying_signals"), list) else []), result.signal_description])[:10]
    merged_evidence = [item for item in metadata.get("buying_signal_evidence", []) if isinstance(item, dict)] if isinstance(metadata.get("buying_signal_evidence"), list) else []
    evidence_entry = {"source_url": result.source_url, "value": result.evidence_summary, "source_field": "ai_customer_finder.source"}
    if not any(str(item.get("source_url") or "") == result.source_url for item in merged_evidence):
        merged_evidence = [*merged_evidence, evidence_entry][-10:]
    live_update = {
        **live,
        "generated_at": datetime.utcnow().isoformat(),
        "current_score": current_score,
        "previous_score": previous_score,
        "score_delta": score_delta,
        "latest_changes": latest_changes,
        "change_timeline": timeline,
        "snapshot": {
            **(live.get("snapshot") if isinstance(live.get("snapshot"), dict) else {}),
            "latest_signal_type": result.signal_type,
            "latest_signal": result.signal_description,
            "latest_source_url": result.source_url,
        },
    }
    company.metadata_json = {
        **metadata,
        "buying_signals": merged_signals,
        "buying_signal_score": current_score,
        "buying_signal_confidence": result.confidence_score,
        "buying_signal_evidence": merged_evidence,
        "priority_score": current_score,
        "confidence_score": result.confidence_score,
        "ai_live_buying_signals": live_update,
    }
    from app.services.revenue_intelligence import build_and_store_revenue_intelligence

    build_and_store_revenue_intelligence(db, company=company)
    result.metadata_json = {
        **(result.metadata_json or {}),
        "previous_score": previous_score,
        "score_delta": score_delta,
        "intent_alert": intent_alert,
        "intent_timeline": timeline,
    }
    db.add(
        AuditLog(
            user_id=job.user_id,
            workspace_id=job.workspace_id,
            action="ai_customer_finder.intent_score_changed",
            metadata_json={"company_id": str(company.id), "result_id": str(result.id), "previous_score": previous_score, "current_score": current_score, "score_delta": score_delta, "signal_type": result.signal_type},
        )
    )
    notification_title = f"{result.company_name} intent score increased to {current_score}"
    if intent_alert and not _recent_notification_exists(db, workspace_id=job.workspace_id, user_id=job.user_id, title=notification_title):
        db.add(
            Notification(
                user_id=job.user_id,
                workspace_id=job.workspace_id,
                kind=NotificationKind.success,
                title=notification_title,
                message=f"{_human_signal_type(result.signal_type)} raised intent by {score_delta} points. Review the verified source before outreach.",
            )
        )


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return fallback


def _score_or_none(value: Any) -> int | None:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return None


def _dedupe_strings(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        text = str(value or "").strip()
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        output.append(text)
    return output


def _change_type_for_signal(signal_type: str) -> str:
    if signal_type == "hiring_related_workflow":
        return "new_hiring"
    if signal_type == "funding_or_growth":
        return "new_funding"
    if signal_type == "public_technology_adoption":
        return "technology_changes"
    if signal_type == "company_expansion_or_launch":
        return "market_expansion"
    if signal_type == "manual_workaround":
        return "workflow_pain"
    return "intent_signal"


def _human_signal_type(signal_type: str) -> str:
    return signal_type.replace("_", " ").capitalize()


def _scoped_job(db: Session, *, workspace_id: UUID, job_id: UUID) -> AICustomerFinderJob:
    job = db.scalar(select(AICustomerFinderJob).where(AICustomerFinderJob.id == job_id, AICustomerFinderJob.workspace_id == workspace_id))
    if job is None:
        raise ValueError("AI Customer Finder job not found.")
    return job


def _set_progress(db: Session, job: AICustomerFinderJob, stage: str, message: str, percent: int, *, claim_token: str | None = None, summary: dict[str, Any] | None = None) -> None:
    if claim_token and job.locked_by != claim_token:
        return
    job.status = stage if stage in {"searching", "verifying", "enriching"} else job.status
    job.progress_json = {"stage": stage, "message": message, "percent": max(0, min(100, percent)), **(summary or {})}
    if summary:
        job.summary_json = {**(job.summary_json if isinstance(job.summary_json, dict) else {}), **summary}
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)


def _mark_cancelled(db: Session, job: AICustomerFinderJob, message: str, *, claim_token: str | None = None) -> None:
    if claim_token and job.locked_by != claim_token:
        return
    job.status = "failed"
    job.error_message = message
    job.progress_json = {"stage": "failed", "message": message, "percent": 100}
    job.locked_by = ""
    job.locked_at = None
    job.completed_at = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    db.commit()


def _evidence_excerpt(text: str, criteria: CustomerFinderCriteria) -> str:
    sentences = [item.strip() for item in text.replace("\n", " ").split(".") if len(item.strip()) > 40]
    terms = [criteria.target_industry.lower(), *[item.lower() for item in criteria.keywords], *criteria.product_or_service.lower().split()[:6]]
    for sentence in sentences:
        lower = sentence.lower()
        if any(term and term in lower for term in terms):
            return sentence[:500]
    return (sentences[0] if sentences else text[:500])[:500]


def _observed_fact(signal_type: str, excerpt: str, company_name: str) -> str:
    label = _human_signal_type(signal_type).lower()
    evidence = (excerpt or "").strip()
    if not evidence:
        return f"{company_name} has a public {label} signal."
    return f"Public source shows {label} evidence: {evidence[:220]}"


def _model_inference(signal_type: str, criteria: CustomerFinderCriteria) -> str:
    return f"This signal may indicate timing for {criteria.product_or_service[:140]} in the {criteria.target_industry} segment."


def _first_line_opener(company_name: str, observed_fact: str) -> str:
    fact = observed_fact.rstrip(".")
    fact = fact.replace("Public source shows ", "").replace("public source shows ", "")
    return f"I noticed {company_name}'s public site shows {fact[0].lower() + fact[1:] if fact else 'a current business signal'}."


def _draft_email(criteria: CustomerFinderCriteria, company_name: str, first_line: str, model_inference: str) -> str:
    role = ", ".join(criteria.contact_titles[:2]) or "there"
    return (
        f"Hi {role},\n\n"
        f"{first_line}\n\n"
        f"We help teams with {criteria.product_or_service[:180]}. {model_inference}\n\n"
        "Would it be worth a quick fit review?\n\n"
        "Draft only — review before sending."
    )


def _signal_description(signal_type: str, company_name: str, criteria: CustomerFinderCriteria) -> str:
    labels = {
        "explicit_solution_request": "Public source suggests explicit solution-seeking language.",
        "manual_workaround": "Public source contains manual-workflow or workaround language.",
        "hiring_related_workflow": "Public source contains hiring or role-growth language related to the workflow.",
        "funding_or_growth": "Public source contains growth or funding language.",
        "company_expansion_or_launch": "Public source contains launch or expansion language.",
        "public_technology_adoption": "Public source contains relevant technology or workflow language.",
        "public_company_fit": "Official public source confirms this company matches the requested ICP.",
    }
    return f"{company_name}: {labels.get(signal_type, 'Public source matches the requested ICP.')} Target: {criteria.target_industry} in {criteria.target_country}."


def _recent_notification_exists(db: Session, *, workspace_id: UUID, user_id: str, title: str, hours: int = 24) -> bool:
    since = datetime.utcnow() - timedelta(hours=hours)
    existing = db.scalar(
        select(Notification.id)
        .where(
            Notification.workspace_id == workspace_id,
            Notification.user_id == user_id,
            Notification.title == title,
            Notification.created_at >= since,
        )
        .limit(1)
    )
    return existing is not None
