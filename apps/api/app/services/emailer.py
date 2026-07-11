from __future__ import annotations

import logging
from email.utils import formataddr
from typing import Optional

import resend

from app.core.config import get_settings

logger = logging.getLogger("outreachai.emailer")


class EmailProviderConfigurationError(RuntimeError):
    pass


class EmailProviderRequestError(RuntimeError):
    pass


def send_email(*, to_email: str, subject: str, body: str, reply_to: Optional[str] = None, from_email: Optional[str] = None, from_name: Optional[str] = None) -> dict:
    settings = get_settings()
    if not settings.resend_api_key:
        raise EmailProviderConfigurationError("RESEND_API_KEY is required for production email sending.")
    sender_email = (from_email or settings.resend_from_email).strip()
    if not sender_email:
        raise EmailProviderConfigurationError("RESEND_FROM_EMAIL must be a verified production sender.")

    resend.api_key = settings.resend_api_key
    sender = formataddr((from_name.strip(), sender_email)) if from_name and "<" not in sender_email else sender_email
    payload = {
        "from": sender,
        "to": [to_email],
        "subject": subject,
        "text": body,
    }
    configured_reply_to = reply_to or settings.resend_reply_to
    if configured_reply_to:
        payload["reply_to"] = configured_reply_to
    try:
        response = resend.Emails.send(payload)
    except Exception as exc:
        logger.exception("Resend email send failed")
        raise EmailProviderRequestError(str(exc)) from exc
    if not isinstance(response, dict) or not response.get("id"):
        raise EmailProviderRequestError("Resend returned an unexpected response.")
    return response
