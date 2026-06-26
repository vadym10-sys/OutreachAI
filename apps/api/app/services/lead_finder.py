from __future__ import annotations

from app.schemas.dto import LeadFinderRequest, LeadOut


class LeadSourceConfigurationError(RuntimeError):
    pass


def find_leads(payload: LeadFinderRequest) -> list[LeadOut]:
    raise LeadSourceConfigurationError(
        "A production prospect data provider is required before Lead Finder can import verified prospects."
    )
