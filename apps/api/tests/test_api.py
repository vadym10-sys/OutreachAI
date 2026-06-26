from pathlib import Path
from datetime import datetime
import hashlib
import hmac
import json
import tempfile
import os
import time

from fastapi.testclient import TestClient

db_path = Path(tempfile.gettempdir()) / "outreachai-api-tests.db"
if db_path.exists():
    db_path.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test"

from app.core.database import Base, get_engine, get_sessionmaker  # noqa: E402
from app.models.entities import AppSettings, Campaign, EmailMessage, Lead, LeadStatus, Subscription  # noqa: E402
from app.schemas.dto import EmailVariantOut  # noqa: E402
from app.main import app  # noqa: E402

Base.metadata.create_all(bind=get_engine())

client = TestClient(app)
AUTH = {"Authorization": "Bearer dev"}


def stripe_signature(payload: dict) -> tuple[str, str]:
    raw = json.dumps(payload, separators=(",", ":"))
    timestamp = str(int(time.time()))
    signed = f"{timestamp}.{raw}".encode()
    digest = hmac.new(os.environ["STRIPE_WEBHOOK_SECRET"].encode(), signed, hashlib.sha256).hexdigest()
    return raw, f"t={timestamp},v1={digest}"


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_find_leads_requires_production_provider() -> None:
    response = client.post(
        "/api/leads/find",
        headers=AUTH,
        json={"niche": "Real estate", "country": "United States", "city": "Austin"}
    )
    assert response.status_code == 503
    assert "production prospect data provider" in response.json()["detail"]


def test_campaign_lead_email_and_dashboard_flow(monkeypatch) -> None:
    def generated_email(_payload):
        return EmailVariantOut(
            subject="Quick idea for Hill Country Build Co",
            preview="A short growth idea",
            full_email="Hi Jane, I found a clear outbound opportunity.",
            cta="Book a growth audit",
            follow_ups=["Following up with one idea.", "Worth a quick look?"],
            ab_tests=[],
        )

    monkeypatch.setattr("app.api.routes.personalize_email", generated_email)

    campaign_response = client.post(
        "/api/campaigns",
        headers=AUTH,
        json={
            "name": "Austin Builders Outreach",
            "industry": "Construction",
            "countries": ["United States"],
            "cities": ["Austin"],
            "company_size": "11-50",
            "keywords": ["commercial renovation"],
            "website_filters": ["has contact page"],
            "language": "English",
            "offer": "book qualified renovation leads",
            "cta": "Book a 15 minute growth audit",
            "email_tone": "consultative",
            "signature": "Vadym, OutreachAI",
        },
    )
    assert campaign_response.status_code == 200
    campaign = campaign_response.json()
    assert campaign["industry"] == "Construction"

    lead_response = client.post(
        "/api/leads",
        headers=AUTH,
        json={
            "company": "Hill Country Build Co",
            "website": "https://example.com",
            "industry": "Construction",
            "country": "United States",
            "city": "Austin",
            "contact": "Jane Doe",
            "email": "jane@example.com",
            "status": "Qualified",
            "campaign_id": campaign["id"],
        },
    )
    assert lead_response.status_code == 200
    lead = lead_response.json()
    assert lead["status"] == "Qualified"

    email_response = client.post(
        "/api/emails/generate",
        headers=AUTH,
        json={"campaign_id": campaign["id"], "lead_id": lead["id"]},
    )
    assert email_response.status_code == 200
    email = email_response.json()
    assert email["subject"]
    assert email["body"]
    assert email["follow_up_1"]

    list_response = client.get("/api/leads?search=Hill&status=Qualified", headers=AUTH)
    assert list_response.status_code == 200
    assert list_response.json()["total"] == 1

    dashboard_response = client.get("/api/dashboard", headers=AUTH)
    assert dashboard_response.status_code == 200
    metrics = dashboard_response.json()
    assert metrics["leads"] >= 1
    assert metrics["campaigns"] >= 1


def test_resend_webhook_updates_delivery_metrics() -> None:
    db = get_sessionmaker()()
    try:
        campaign = Campaign(user_id="dev_user", name="Webhook Campaign", industry="Construction")
        db.add(campaign)
        db.flush()
        lead = Lead(
            user_id="dev_user",
            campaign_id=campaign.id,
            company="Webhook Build Co",
            email="webhook@example.com",
            status=LeadStatus.sent,
        )
        db.add(lead)
        db.flush()
        message = EmailMessage(
            user_id="dev_user",
            campaign_id=campaign.id,
            lead_id=lead.id,
            direction="outbound",
            subject="Webhook test",
            body="Hello",
            provider_message_id="resend-msg-1",
            delivery_status="sent",
            sent_at=datetime.utcnow(),
        )
        db.add(message)
        db.commit()
    finally:
        db.close()

    delivered = client.post("/webhooks/resend", json={"type": "email.delivered", "data": {"email_id": "resend-msg-1"}})
    assert delivered.status_code == 200
    assert delivered.json()["matched"] is True

    opened = client.post("/webhooks/resend", json={"type": "email.opened", "data": {"email_id": "resend-msg-1"}})
    assert opened.status_code == 200

    metrics = client.get("/api/dashboard", headers=AUTH).json()
    assert metrics["delivered"] >= 1
    assert metrics["opened"] >= 1
    assert metrics["open_rate"] > 0
    activity = client.get("/api/activity", headers=AUTH).json()
    assert any(item["action"] == "resend.email.delivered" for item in activity)

    lead_page = client.get("/api/leads?search=Webhook", headers=AUTH).json()
    assert lead_page["items"][0]["status"] == "Contacted"


def test_resend_webhook_handles_bounce_complaint_and_reply(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.webhooks.suggest_reply",
        lambda payload: type("Assistant", (), {"model_dump": lambda self: {"next_step": "Book meeting", "qualification_score": 80}})(),
    )
    db = get_sessionmaker()()
    try:
        campaign = Campaign(user_id="dev_user", name="Reply Campaign", industry="Construction")
        db.add(campaign)
        db.flush()
        lead = Lead(user_id="dev_user", campaign_id=campaign.id, company="Reply Build Co", email="reply@example.com", status=LeadStatus.sent)
        db.add(lead)
        db.flush()
        message = EmailMessage(
            user_id="dev_user",
            campaign_id=campaign.id,
            lead_id=lead.id,
            direction="outbound",
            subject="Reply test",
            body="Hello",
            provider_message_id="resend-msg-2",
            delivery_status="sent",
            sent_at=datetime.utcnow(),
        )
        db.add(message)
        db.commit()
    finally:
        db.close()

    bounced = client.post("/webhooks/resend", json={"type": "email.bounced", "data": {"email_id": "resend-msg-2"}})
    assert bounced.status_code == 200
    complained = client.post("/webhooks/resend", json={"type": "email.complained", "data": {"email_id": "resend-msg-2"}})
    assert complained.status_code == 200
    replied = client.post("/webhooks/resend", json={"type": "email.received", "data": {"email_id": "resend-msg-2", "text": "Interested."}})
    assert replied.status_code == 200

    db = get_sessionmaker()()
    try:
        saved = db.query(EmailMessage).filter(EmailMessage.provider_message_id == "resend-msg-2").one()
        assert saved.delivery_status == "replied"
        assert saved.bounced_at is not None
        assert saved.replied_at is not None
        assert saved.reply_body == "Interested."
        lead = db.get(Lead, saved.lead_id)
        assert lead and lead.status == LeadStatus.interested
    finally:
        db.close()


def test_workspace_onboarding_usage_and_campaign_duplicate() -> None:
    workspace_response = client.get("/api/workspace", headers=AUTH)
    assert workspace_response.status_code == 200
    workspace = workspace_response.json()
    assert workspace["members"][0]["role"] == "Owner"

    onboarding = client.put(
        "/api/onboarding",
        headers=AUTH,
        json={
            "company": "OutreachAI",
            "industry": "B2B SaaS",
            "target_country": "United States",
            "target_customer": "real estate agencies",
            "connect_openai": True,
            "launch_first_campaign": True,
            "step": 6,
        },
    )
    assert onboarding.status_code == 200
    assert onboarding.json()["onboarding_completed"] is True

    campaign = client.post(
        "/api/campaigns",
        headers=AUTH,
        json={
            "name": "Commercial Sequence",
            "industry": "Real estate",
            "countries": ["United States"],
            "cities": ["Miami"],
            "offer": "book more seller appointments",
            "cta": "Book a call",
            "timezone": "America/New_York",
            "sequence": [
                {"step_order": 1, "name": "Email #1", "subject": "Seller appointment idea", "body": "Intro", "delay_days": 0},
                {"step_order": 2, "name": "Follow-up #1", "subject": "Following up", "body": "Follow", "delay_days": 3},
            ],
        },
    ).json()
    assert campaign["sequence"][0]["name"] == "Email #1"

    duplicate = client.post(f"/api/campaigns/{campaign['id']}/duplicate", headers=AUTH)
    assert duplicate.status_code == 200
    assert duplicate.json()["name"].endswith("copy")

    usage = client.get("/api/billing/usage", headers=AUTH)
    assert usage.status_code == 200
    assert usage.json()["plan"] == "Starter"

    admin = client.get("/api/admin/summary", headers=AUTH)
    assert admin.status_code == 200
    assert "system_health" in admin.json()


def test_stripe_webhook_activates_subscription() -> None:
    workspace = client.get("/api/workspace", headers=AUTH).json()
    payload = {
        "id": "evt_test_checkout",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_live_test",
                "customer": "cus_live_test",
                "subscription": "sub_live_test",
                "metadata": {"user_id": "dev_user", "workspace_id": workspace["id"], "plan": "Pro"},
            }
        },
    }
    raw, signature = stripe_signature(payload)
    response = client.post("/webhooks/stripe", content=raw, headers={"stripe-signature": signature, "content-type": "application/json"})
    assert response.status_code == 200
    assert response.json()["type"] == "checkout.session.completed"

    db = get_sessionmaker()()
    try:
        subscription = db.query(Subscription).filter(Subscription.stripe_subscription_id == "sub_live_test").one()
        assert subscription.plan == "Pro"
        assert subscription.status == "active"
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == subscription.workspace_id).one()
        assert settings.billing["plan"] == "Pro"
        assert settings.billing["stripeCustomerId"] == "cus_live_test"
    finally:
        db.close()

    unsigned = client.post("/webhooks/stripe", json=payload)
    assert unsigned.status_code == 400
