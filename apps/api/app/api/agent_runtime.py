from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.routes import _current_workspace
from app.core.database import get_db
from app.core.security import WorkspaceUserContext
from app.services.agent_runtime.errors import (
    AgentRunStateError,
    AgentRuntimeError,
    ApprovalStateError,
    FeatureDisabledError,
    IdempotencyConflictError,
    PaginationCursorError,
)
from app.services.agent_runtime.orchestrator import (
    AgentRuntimeOrchestrator,
    run_out,
)
from app.services.agent_runtime.schemas import (
    AgentApprovalDecisionIn,
    AgentApprovalRequestPageOut,
    AgentApprovalRejectIn,
    AgentRunCancelIn,
    AgentRunCreateIn,
    AgentRunDetailOut,
    AgentRunOut,
    AgentRunPageOut,
    AgentRuntimeStatusOut,
    AgentRunTraceOut,
    AgentStepOut,
    ApprovalQueueState,
    RunStatus,
    ToolRegistryItemOut,
)

router = APIRouter()
_orchestrator = AgentRuntimeOrchestrator()


def _http_error(exc: AgentRuntimeError) -> HTTPException:
    if isinstance(exc, FeatureDisabledError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI Control Plane is disabled.",
        )
    if isinstance(exc, ApprovalStateError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, IdempotencyConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Idempotency request already exists with a different payload.",
        )
    if isinstance(exc, PaginationCursorError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid pagination cursor.")
    if isinstance(exc, AgentRunStateError):
        message = str(exc)
        if "not found" in message.lower():
            return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent run not found.")
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/tools", response_model=list[ToolRegistryItemOut])
def list_agent_tools(
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> list[ToolRegistryItemOut]:
    _current_workspace(db, user.user_id, user.email)
    return _orchestrator.list_tools()


@router.get("/status", response_model=AgentRuntimeStatusOut)
def get_agent_runtime_status(
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> AgentRuntimeStatusOut:
    _current_workspace(db, user.user_id, user.email)
    return _orchestrator.runtime_status()


@router.get("/approvals", response_model=AgentApprovalRequestPageOut)
def list_agent_approvals(
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
    approval_status: ApprovalQueueState = Query(default="pending", alias="status"),
    cursor: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=50),
) -> AgentApprovalRequestPageOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        return _orchestrator.list_approvals(
            db,
            workspace_id=workspace.id,
            approval_state=approval_status,
            cursor=cursor,
            limit=limit,
        )
    except AgentRuntimeError as exc:
        raise _http_error(exc) from exc


@router.post("", response_model=AgentRunDetailOut, status_code=202)
def create_agent_run(
    payload: AgentRunCreateIn,
    request: Request,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> AgentRunDetailOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    request_id = request.headers.get("x-request-id") or str(uuid4())
    try:
        run = _orchestrator.create_run(
            db,
            workspace=workspace,
            user_id=user.user_id,
            payload=payload,
            request_id=request_id,
        )
        db.commit()
    except AgentRuntimeError as exc:
        db.rollback()
        raise _http_error(exc) from exc
    return _orchestrator.get_run_detail(db, workspace_id=workspace.id, run_id=run.id)


@router.get("", response_model=AgentRunPageOut)
def list_agent_runs(
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
    run_status: RunStatus | None = Query(default=None, alias="status"),
    cursor: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=50),
) -> AgentRunPageOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        return _orchestrator.list_runs(
            db,
            workspace_id=workspace.id,
            status_filter=run_status,
            cursor=cursor,
            limit=limit,
        )
    except AgentRuntimeError as exc:
        raise _http_error(exc) from exc


@router.get("/{run_id}", response_model=AgentRunDetailOut)
def get_agent_run(
    run_id: UUID,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> AgentRunDetailOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        return _orchestrator.get_run_detail(db, workspace_id=workspace.id, run_id=run_id)
    except AgentRuntimeError as exc:
        raise _http_error(exc) from exc


@router.get("/{run_id}/steps", response_model=list[AgentStepOut])
def get_agent_run_steps(
    run_id: UUID,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> list[AgentStepOut]:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        return _orchestrator.get_run_detail(db, workspace_id=workspace.id, run_id=run_id).steps
    except AgentRuntimeError as exc:
        raise _http_error(exc) from exc


@router.get("/{run_id}/trace", response_model=AgentRunTraceOut)
def get_agent_run_trace(
    run_id: UUID,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> AgentRunTraceOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        return _orchestrator.get_run_trace(db, workspace_id=workspace.id, run_id=run_id)
    except AgentRuntimeError as exc:
        raise _http_error(exc) from exc


@router.post("/{run_id}/approve", response_model=AgentRunOut)
def approve_agent_run(
    run_id: UUID,
    payload: AgentApprovalDecisionIn,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> AgentRunOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        run = _orchestrator.approve(
            db,
            workspace=workspace,
            user_id=user.user_id,
            run_id=run_id,
            payload=payload,
        )
        db.commit()
        return run_out(run)
    except AgentRuntimeError as exc:
        db.rollback()
        raise _http_error(exc) from exc


@router.post("/{run_id}/reject", response_model=AgentRunOut)
def reject_agent_run(
    run_id: UUID,
    payload: AgentApprovalRejectIn,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> AgentRunOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        run = _orchestrator.reject(
            db,
            workspace=workspace,
            user_id=user.user_id,
            run_id=run_id,
            approval_request_id=payload.approval_request_id,
            reason=payload.reason,
        )
        db.commit()
        return run_out(run)
    except AgentRuntimeError as exc:
        db.rollback()
        raise _http_error(exc) from exc


@router.post("/{run_id}/resume", response_model=AgentRunDetailOut)
def resume_agent_run(
    run_id: UUID,
    request: Request,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> AgentRunDetailOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    request_id = request.headers.get("x-request-id") or str(uuid4())
    try:
        run = _orchestrator.resume(
            db,
            workspace=workspace,
            user_id=user.user_id,
            run_id=run_id,
            request_id=request_id,
        )
        db.commit()
        return _orchestrator.get_run_detail(db, workspace_id=workspace.id, run_id=run.id)
    except AgentRuntimeError as exc:
        db.rollback()
        raise _http_error(exc) from exc


@router.post("/{run_id}/cancel", response_model=AgentRunOut)
def cancel_agent_run(
    run_id: UUID,
    payload: AgentRunCancelIn,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> AgentRunOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    try:
        run = _orchestrator.cancel(
            db,
            workspace=workspace,
            user_id=user.user_id,
            run_id=run_id,
            reason=payload.reason,
        )
        db.commit()
        return run_out(run)
    except AgentRuntimeError as exc:
        db.rollback()
        raise _http_error(exc) from exc
