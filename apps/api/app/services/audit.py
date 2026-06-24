from __future__ import annotations

from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.entities import AuditLog


def log_event(db: Session, request: Request, user_id: Optional[str], action: str, metadata: Optional[dict] = None) -> None:
    ip = request.headers.get("x-forwarded-for", "").split(",")[0] or (request.client.host if request.client else None)
    db.add(AuditLog(user_id=user_id, action=action, ip_address=ip, metadata_json=metadata or {}))
    db.commit()
