from pathlib import Path
from datetime import datetime
import tempfile
import os

from fastapi.testclient import TestClient

db_path = Path(tempfile.gettempdir()) / "outreachai-api-tests.db"
if db_path.exists():
    db_path.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["AUTO_CREATE_TABLES"] = "true"

from app.core.database import Base, get_engine, get_sessionmaker  # noqa: E402
from app.models.entities import Campaign, EmailMessage, Lead, LeadStatus  # noqa: E402
from app.schemas.dto import EmailVariantOut  # noqa: E402
from app.main import app  # noqa: E402

Base.metadata.create_all(bind=get_engine())

client = TestClient(app)
AUTH = {"Authorization": "Bearer dev"}


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

    list_response = client.get("/api/leads?search=Hill&status=Email%20Generated", headers=AUTH)
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
    assert lead_page["items"][0]["status"] == "Opened"


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
        assert lead and lead.status == LeadStatus.replied
    finally:
        db.close()
