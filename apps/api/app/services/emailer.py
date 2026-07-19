from __future__ import annotations

import logging
import smtplib
import ssl
import base64
from email.utils import formataddr
from email.message import EmailMessage
from typing import Any, Optional

import httpx
import resend

from app.core.config import get_settings

logger = logging.getLogger("outreachai.emailer")
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


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


def _gmail_access_token(oauth_config: dict[str, Any] | None) -> str:
    config = oauth_config or {}
    refresh_token = str(config.get("refresh_token") or "").strip()
    client_id = str(config.get("client_id") or "").strip()
    client_secret = str(config.get("client_secret") or "").strip()
    if not refresh_token or not client_id or not client_secret:
        raise EmailProviderConfigurationError("Gmail OAuth sender setup is incomplete.")
    try:
        with httpx.Client(timeout=httpx.Timeout(12.0, connect=4.0)) as client:
            response = client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.exception("Gmail OAuth token refresh failed")
        raise EmailProviderRequestError("Gmail OAuth token refresh failed.") from exc
    access_token = str(data.get("access_token") or "").strip()
    if not access_token:
        raise EmailProviderRequestError("Gmail did not return an access token.")
    return access_token


def _send_gmail_email(*, to_email: str, subject: str, body: str, reply_to: Optional[str], from_email: Optional[str], from_name: Optional[str], oauth_config: dict[str, Any] | None) -> dict:
    sender_email = str(from_email or "").strip()
    if not sender_email:
        raise EmailProviderConfigurationError("Gmail sender email is required.")
    message = EmailMessage()
    message["From"] = formataddr((from_name.strip(), sender_email)) if from_name else sender_email
    message["To"] = to_email
    message["Subject"] = subject
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(body)
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8").rstrip("=")
    token = _gmail_access_token(oauth_config)
    try:
        with httpx.Client(timeout=httpx.Timeout(15.0, connect=4.0)) as client:
            response = client.post(GMAIL_SEND_URL, headers={"Authorization": f"Bearer {token}"}, json={"raw": raw})
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.exception("Gmail email send failed")
        raise EmailProviderRequestError("Gmail email sending failed.") from exc
    message_id = str(data.get("id") or "").strip()
    if not message_id:
        raise EmailProviderRequestError("Gmail returned an unexpected response.")
    return {"id": message_id, "thread_id": data.get("threadId"), "provider": "gmail"}


def verify_smtp_connection(*, host: str, port: int, username: str, password: str, use_tls: bool = True) -> None:
    host = str(host or "").strip()
    username = str(username or "").strip()
    password = str(password or "").strip()
    port = int(port or 587)
    if not host or not username or not password:
        raise EmailProviderConfigurationError("SMTP sender setup is incomplete.")
    try:
        if use_tls:
            with smtplib.SMTP(host, port, timeout=15) as client:
                client.starttls(context=ssl.create_default_context())
                client.login(username, password)
        else:
            with smtplib.SMTP_SSL(host, port, timeout=15, context=ssl.create_default_context()) as client:
                client.login(username, password)
    except Exception as exc:
        logger.warning("SMTP connection verification failed for host=%s username=%s", host, username)
        raise EmailProviderRequestError("SMTP connection could not be verified. Check host, port, username and app password.") from exc


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
    oauth_config: dict[str, Any] | None = None,
) -> dict:
    if provider == "smtp":
        return _send_smtp_email(to_email=to_email, subject=subject, body=body, reply_to=reply_to, from_email=from_email, from_name=from_name, smtp_config=smtp_config)
    if provider == "gmail":
        return _send_gmail_email(to_email=to_email, subject=subject, body=body, reply_to=reply_to, from_email=from_email, from_name=from_name, oauth_config=oauth_config or smtp_config)
    return _send_resend_email(to_email=to_email, subject=subject, body=body, reply_to=reply_to, from_email=from_email, from_name=from_name)
