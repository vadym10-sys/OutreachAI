from __future__ import annotations

from app.schemas.dto import LeadFinderRequest, LeadOut
from app.services.google_maps import GoogleMapsConfigurationError, GoogleMapsRequestError, search_google_places


class LeadSourceConfigurationError(GoogleMapsConfigurationError):
    pass


class LeadSourceRequestError(GoogleMapsRequestError):
    pass


def find_leads(payload: LeadFinderRequest) -> list[LeadOut]:
    try:
        return search_google_places(payload).leads
    except GoogleMapsConfigurationError as exc:
        raise LeadSourceConfigurationError(str(exc)) from exc
    except GoogleMapsRequestError as exc:
        raise LeadSourceRequestError(str(exc)) from exc
