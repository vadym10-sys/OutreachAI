from __future__ import annotations

from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Workspace, WorkspaceMember, WorkspaceRole


class AgentRuntimePermissionResolver(Protocol):
    def allowed_permissions(
        self,
        db: Session,
        *,
        workspace: Workspace,
        user_id: str,
    ) -> set[str]:
        ...


OWNER_PERMISSIONS = frozenset(
    {
        "workspace:read",
        "customer_finder:read",
        "crm:read",
        "contacts:read",
        "crm:write",
        "email:draft",
        "email:send",
        "gmail:read",
    }
)
ADMIN_PERMISSIONS = frozenset(
    {
        "workspace:read",
        "customer_finder:read",
        "crm:read",
        "contacts:read",
        "crm:write",
        "email:draft",
    }
)
MANAGER_PERMISSIONS = frozenset(
    {
        "workspace:read",
        "customer_finder:read",
        "crm:read",
        "contacts:read",
        "email:draft",
    }
)
MEMBER_PERMISSIONS = frozenset({"workspace:read", "crm:read", "contacts:read"})

ROLE_PERMISSIONS: dict[WorkspaceRole, frozenset[str]] = {
    WorkspaceRole.owner: OWNER_PERMISSIONS,
    WorkspaceRole.admin: ADMIN_PERMISSIONS,
    WorkspaceRole.manager: MANAGER_PERMISSIONS,
    WorkspaceRole.member: MEMBER_PERMISSIONS,
}


class WorkspaceRolePermissionResolver:
    def allowed_permissions(
        self,
        db: Session,
        *,
        workspace: Workspace,
        user_id: str,
    ) -> set[str]:
        member = db.scalar(
            select(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.user_id == user_id,
                WorkspaceMember.status == "active",
            )
            .order_by(WorkspaceMember.created_at.asc())
        )
        if member is None and workspace.owner_user_id == user_id:
            return set(OWNER_PERMISSIONS)
        if member is None:
            return set()
        return set(ROLE_PERMISSIONS.get(member.role, MEMBER_PERMISSIONS))
