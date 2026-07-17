from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes import _current_workspace
from app.core.database import get_db
from app.core.security import WorkspaceUserContext
from app.models.entities import AICustomerFinderJob
from app.services.ai_customer_finder.schemas import CustomerFinderCriteria, CustomerFinderJobOut
from app.services.ai_customer_finder.service import cancel_ai_customer_finder_job, enqueue_ai_customer_finder_job, job_out

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
