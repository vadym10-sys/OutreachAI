from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes import _current_workspace, _limits_for_workspace, _plan_for_workspace, _upgrade_message
from app.core.database import get_db
from app.core.security import WorkspaceUserContext
from app.services.revenue_intelligence import OpportunityFeedOut, RevenueCompanyOut, build_revenue_intelligence_feed, set_company_watchlist

router = APIRouter()


class WatchlistUpdateIn(BaseModel):
    watchlisted: bool


@router.get("", response_model=OpportunityFeedOut)
def get_revenue_intelligence(
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> OpportunityFeedOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    plan = _plan_for_workspace(db, user.user_id, workspace)
    if not _limits_for_workspace(db, user.user_id, workspace)["advanced_analytics"]:
        raise HTTPException(status_code=402, detail=_upgrade_message(plan, "Advanced Analytics"))
    return build_revenue_intelligence_feed(db, workspace=workspace, user_id=user.user_id)


@router.post("/companies/{company_id}/watchlist", response_model=RevenueCompanyOut)
def update_company_watchlist(
    company_id: UUID,
    payload: WatchlistUpdateIn,
    user: WorkspaceUserContext,
    db: Session = Depends(get_db),
) -> RevenueCompanyOut:
    workspace = _current_workspace(db, user.user_id, user.email)
    plan = _plan_for_workspace(db, user.user_id, workspace)
    if not _limits_for_workspace(db, user.user_id, workspace)["advanced_analytics"]:
        raise HTTPException(status_code=402, detail=_upgrade_message(plan, "Advanced Analytics"))
    try:
        return set_company_watchlist(
            db,
            workspace_id=workspace.id,
            user_id=user.user_id,
            company_id=company_id,
            watchlisted=payload.watchlisted,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
