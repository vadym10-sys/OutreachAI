from __future__ import annotations

import json
from typing import Optional

from openai import OpenAI

from app.core.config import get_settings
from app.schemas.dto import AnalysisOut, EmailVariantOut, PersonalizeRequest


def _client() -> Optional[OpenAI]:
    settings = get_settings()
    if not settings.openai_api_key:
        return None
    return OpenAI(api_key=settings.openai_api_key)


def analyze_website(company: str, website: str, niche: Optional[str] = None) -> AnalysisOut:
    client = _client()
    if client is None:
        return AnalysisOut(
            niche=niche or "B2B services",
            services=["Lead generation", "Client acquisition", "Online presence"],
            strengths=["Clear market positioning", "Visible contact options"],
            weaknesses=["Generic messaging", "Limited social proof", "No clear conversion path"],
            summary=f"{company} appears to serve {niche or 'B2B'} buyers. The best outreach angle is a concise audit tied to revenue leakage on {website}."
        )

    prompt = {
        "company": company,
        "website": website,
        "niche": niche,
        "task": "Return JSON with niche, services, strengths, weaknesses, summary."
    }
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": json.dumps(prompt)}],
        response_format={"type": "json_object"}
    )
    data = json.loads(response.choices[0].message.content or "{}")
    return AnalysisOut(
        niche=data.get("niche", niche or "B2B services"),
        services=data.get("services", []),
        strengths=data.get("strengths", []),
        weaknesses=data.get("weaknesses", []),
        summary=data.get("summary", "")
    )


def personalize_email(payload: PersonalizeRequest) -> EmailVariantOut:
    client = _client()
    if client is None:
        subject = f"Quick idea for {payload.company}"
        preview = f"A practical way to turn {payload.niche} website traffic into qualified conversations."
        body = (
            f"Hi,\n\nI reviewed {payload.company} and noticed an opportunity around {payload.website_summary}. "
            f"We help {payload.niche} teams turn that into qualified meetings with {payload.offer}.\n\n"
            "Would it be worth sending over a short example tailored to your market?"
        )
        cta = "Reply and I will send the example."
        return EmailVariantOut(
            subject=subject,
            preview=preview,
            full_email=body,
            cta=cta,
            cold_email=f"Subject: {subject}\n\n{body}",
            follow_ups=[
                f"Following up with one practical idea for {payload.company}: use website-specific outreach angles instead of broad pitch copy.",
                "Should I send a short example campaign for your market?"
            ],
            ab_tests=[
                "A: Lead with website audit angle.",
                "B: Lead with missed pipeline and ROI estimate."
            ]
        )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": payload.model_dump_json()}],
        response_format={"type": "json_object"}
    )
    data = json.loads(response.choices[0].message.content or "{}")
    subject = data.get("subject", "")
    body = data.get("full_email") or data.get("cold_email", "")
    return EmailVariantOut(
        subject=subject,
        preview=data.get("preview", ""),
        full_email=body,
        cta=data.get("cta", ""),
        cold_email=data.get("cold_email", f"Subject: {subject}\n\n{body}"),
        follow_ups=data.get("follow_ups", []),
        ab_tests=data.get("ab_tests", [])
    )
