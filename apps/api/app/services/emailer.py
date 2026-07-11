from __future__ import annotations

import logging
import smtplib
import ssl
from email.utils import formataddr
from email.message import EmailMessage
from typing import Any, Optional

import resend

from app.core.config import get_settings

logger = logging.getLogger("outreachai.emailer")


class EmailProviderConfigurationError(RuntimeError):
    pass


class EmailProviderRequestError(RuntimeError):
    pass


def _send_resend_email(*, to_email: str, subject: str, body: str, reply_to: Optional[str], from_email: Optional[str], from_name: Optional[str]) -> dict:
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


def _send_smtp_email(*, to_email: str, subject: str, body: str, reply_to: Optional[str], from_email: Optional[str], from_name: Optional[str], smtp_config: dict[str, Any] | None) -> dict:
    config = smtp_config or {}
    host = str(config.get("host") or "").strip()
    username = str(config.get("username") or "").strip()
    password = str(config.get("password") or "").strip()
    port = int(config.get("port") or 587)
    use_tls = bool(config.get("use_tls", True))
    sender_email = str(from_email or config.get("sender_email") or username).strip()
    if not host or not username or not password or not sender_email:
        raise EmailProviderConfigurationError("SMTP sender setup is incomplete.")

    sender = formataddr((from_name.strip(), sender_email)) if from_name else sender_email
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_email
    message["Subject"] = subject
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(body)

    try:
        if use_tls:
            with smtplib.SMTP(host, port, timeout=20) as client:
                client.starttls(context=ssl.create_default_context())
                client.login(username, password)
                client.send_message(message)
        else:
            with smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context()) as client:
                client.login(username, password)
                client.send_message(message)
    except Exception as exc:
        logger.exception("SMTP email send failed")
        raise EmailProviderRequestError("SMTP email sending failed.") from exc
    return {"id": f"smtp:{host}:{to_email}"}


def send_email(
    *,
    to_email: str,
    subject: str,
    body: str,
    reply_to: Optional[str] = None,
    from_email: Optional[str] = None,
    from_name: Optional[str] = None,
    provider: str = "resend",
    smtp_config: dict[str, Any] | None = None,
) -> dict:
    if provider == "smtp":
        return _send_smtp_email(to_email=to_email, subject=subject, body=body, reply_to=reply_to, from_email=from_email, from_name=from_name, smtp_config=smtp_config)
    return _send_resend_email(to_email=to_email, subject=subject, body=body, reply_to=reply_to, from_email=from_email, from_name=from_name)
