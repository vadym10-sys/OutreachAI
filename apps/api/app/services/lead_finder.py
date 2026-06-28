from __future__ import annotations

from app.schemas.dto import LeadFinderRequest, LeadOut
from app.services.apollo import ApolloConfigurationError, ApolloRequestError, search_apollo_companies


class LeadSourceConfigurationError(ApolloConfigurationError):
    pass


class LeadSourceRequestError(ApolloRequestError):
    pass


def find_leads(payload: LeadFinderRequest) -> list[LeadOut]:
    try:
        return search_apollo_companies(payload).leads
    except ApolloConfigurationError as exc:
        raise LeadSourceConfigurationError(str(exc)) from exc
    except ApolloRequestError as exc:
        raise LeadSourceRequestError(str(exc)) from exc
