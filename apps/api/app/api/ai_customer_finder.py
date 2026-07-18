from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes import _current_workspace
from app.core.database import get_db
from app.core.security import WorkspaceUserContext
from app.models.entities import AICustomerFinderJob, AICustomerFinderResult, EmailMessage
from app.services.ai_customer_finder.schemas import CustomerFinderCriteria, CustomerFinderJobOut, CustomerFinderResultActionOut
from app.services.ai_customer_finder.service import (
    SIMPLE_STATUS_DRAFT_READY,
    SIMPLE_STATUS_SENT,
    _sync_result_email_metadata,
    cancel_ai_customer_finder_job,
    enqueue_ai_customer_finder_job,
    job_out,
    result_out,
)

router = APIRouter()


@router.post("/searches", response_model=CustomerFinderJobOut, status_code=202)
def create_ai_customer_finder_search(
    payload: CustomerFinderCriteria,
    request: Request,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> CustomerFinderJobOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    request_id = request.headers.get("x-request-id") or str(uuid4())
    job = enqueue_ai_customer_finder_job(
        db,
        user_id=user.user_id,
        workspace_id=workspace.id,
        criteria=payload,
        request_id=request_id,
    )
    db.commit()
    db.refresh(job)
    return job_out(db, job)


@router.get("/searches", response_model=list[CustomerFinderJobOut])
def list_ai_customer_finder_searches(
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> list[CustomerFinderJobOut]:
    workspace = _current_workspace(db, user.user_id, user.email)
    jobs = list(
        db.scalars(
            select(AICustomerFinderJob)
            .where(AICustomerFinderJob.workspace_id == workspace.id)
            .order_by(AICustomerFinderJob.created_at.desc())
            .limit(20)
        ).all()
    )
    return [job_out(db, job) for job in jobs]


@router.get("/searches/{job_id}", response_model=CustomerFinderJobOut)
def get_ai_customer_finder_search(
    job_id: UUID,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> CustomerFinderJobOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    job = db.scalar(select(AICustomerFinderJob).where(AICustomerFinderJob.id == job_id, AICustomerFinderJob.workspace_id == workspace.id))
    if job is None:
        raise HTTPException(status_code=404, detail="AI Customer Finder search not found.")
    return job_out(db, job)


@router.post("/searches/{job_id}/cancel", response_model=CustomerFinderJobOut)
def cancel_ai_customer_finder_search(
    job_id: UUID,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> CustomerFinderJobOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        job = cancel_ai_customer_finder_job(db, workspace_id=workspace.id, job_id=job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return job_out(db, job)


@router.post("/results/{result_id}/draft", response_model=CustomerFinderResultActionOut)
def save_customer_finder_email_draft(
    result_id: UUID,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> CustomerFinderResultActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    result = db.scalar(select(AICustomerFinderResult).where(AICustomerFinderResult.id == result_id, AICustomerFinderResult.workspace_id == workspace.id))
    if result is None:
        raise HTTPException(status_code=404, detail="AI Customer Finder result not found.")
    email = _result_email(db, result)
    if email is None:
        raise HTTPException(status_code=409, detail="Email draft is not ready yet.")
    if email.delivery_status != "sent":
        email.delivery_status = "draft"
    _sync_result_email_metadata(result, email, simple_status=SIMPLE_STATUS_SENT if email.delivery_status == "sent" else SIMPLE_STATUS_DRAFT_READY)
    db.commit()
    db.refresh(result)
    return CustomerFinderResultActionOut(status="success", message="Draft saved in CRM.", result=result_out(result))


@router.post("/results/{result_id}/send", response_model=CustomerFinderResultActionOut)
def send_customer_finder_email(
    result_id: UUID,
    request: Request,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> CustomerFinderResultActionOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    result = db.scalar(select(AICustomerFinderResult).where(AICustomerFinderResult.id == result_id, AICustomerFinderResult.workspace_id == workspace.id))
    if result is None:
        raise HTTPException(status_code=404, detail="AI Customer Finder result not found.")
    email = _result_email(db, result)
    if email is None:
        raise HTTPException(status_code=409, detail="Email draft is not ready yet.")
    if not result.public_work_contact:
        return CustomerFinderResultActionOut(status="error", message="A verified recipient email is required before sending.", result=result_out(result))
    if email.delivery_status != "sent":
        email.delivery_status = "approved"
        db.commit()
    from app.api.usage import send_approved_email

    send_result = send_approved_email(email.id, request, user, db)
    db.refresh(email)
    _sync_result_email_metadata(result, email, simple_status=SIMPLE_STATUS_SENT if email.delivery_status == "sent" else SIMPLE_STATUS_DRAFT_READY)
    db.commit()
    db.refresh(result)
    return CustomerFinderResultActionOut(status=send_result.status, message=send_result.message, result=result_out(result))


def _result_email(db: Session, result: AICustomerFinderResult) -> EmailMessage | None:
    metadata = result.metadata_json if isinstance(result.metadata_json, dict) else {}
    email_meta = metadata.get("email") if isinstance(metadata.get("email"), dict) else {}
    email_id = str(email_meta.get("email_id") or "")
    if email_id:
        try:
            parsed_email_id = UUID(email_id)
        except ValueError:
            parsed_email_id = None
        if parsed_email_id is not None:
            email = db.scalar(select(EmailMessage).where(EmailMessage.id == parsed_email_id, EmailMessage.workspace_id == result.workspace_id))
            if email is not None:
                return email
    if result.lead_id:
        return db.scalar(
            select(EmailMessage)
            .where(
                EmailMessage.workspace_id == result.workspace_id,
                EmailMessage.lead_id == result.lead_id,
                EmailMessage.tags["source"].as_string() == "ai_customer_finder",
            )
            .order_by(EmailMessage.created_at.desc())
        )
    return None
