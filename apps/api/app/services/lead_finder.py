from __future__ import annotations

from app.schemas.dto import LeadFinderRequest, LeadOut


def find_leads(payload: LeadFinderRequest) -> list[LeadOut]:
    seed = payload.city.lower().replace(" ", "")
    niche = payload.niche.lower().replace(" ", "")
    companies = [
        f"{payload.city} Growth Partners",
        f"Prime {payload.niche} Group",
        f"{payload.country} Market Studio",
        f"Urban {payload.niche} Advisors"
    ]
    return [
        LeadOut(
            company=company,
            website=f"https://{seed}-{niche}-{idx}.example.com",
            email=f"hello@{seed}{idx}.example.com",
            phone=f"+1 555 010{idx}",
            linkedin=f"https://linkedin.com/company/{seed}-{idx}",
            niche=payload.niche,
            country=payload.country,
            city=payload.city
        )
        for idx, company in enumerate(companies, start=1)
    ]
