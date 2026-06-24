from __future__ import annotations

import resend

from app.core.config import get_settings


def send_email(to_email: str, subject: str, body: str) -> dict:
    settings = get_settings()
    if not settings.resend_api_key:
        return {"id": "dev_email", "status": "skipped"}

    resend.api_key = settings.resend_api_key
    return resend.Emails.send({
        "from": settings.resend_from_email,
        "to": to_email,
        "subject": subject,
        "text": body
    })
